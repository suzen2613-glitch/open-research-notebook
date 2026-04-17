from typing import Any, Dict, List, Optional

from loguru import logger
from surreal_commands import submit_command

from open_notebook.database.repository import ensure_record_id, repo_query


class CommandService:
    """Generic service layer for command operations"""

    @staticmethod
    def _normalize_command_record(record: Dict[str, Any]) -> Dict[str, Any]:
        progress = record.get("progress")
        result = record.get("result")
        cancel_requested = bool(record.get("cancel_requested"))
        status = record.get("status", "unknown")
        error_message = record.get("error_message")

        if isinstance(result, dict) and result.get("cancelled"):
            status = "canceled"
        elif isinstance(result, dict) and result.get("success") is False:
            status = "failed"
            error_message = (
                result.get("error_message")
                or error_message
                or "Background command returned success=false"
            )
        elif cancel_requested and isinstance(progress, dict):
            if progress.get("phase") == "canceled" and status in {"completed", "failed"}:
                status = "canceled"

        return {
            "job_id": str(record["id"]) if record.get("id") else None,
            "app": record.get("app"),
            "name": record.get("name"),
            "status": status,
            "raw_status": record.get("status", "unknown"),
            "result": result,
            "error_message": error_message,
            "created": str(record["created"]) if record.get("created") else None,
            "updated": str(record["updated"]) if record.get("updated") else None,
            "progress": progress,
            "args": record.get("args"),
            "context": record.get("context"),
            "cancel_requested": cancel_requested,
        }

    @staticmethod
    async def submit_command_job(
        module_name: str,  # Actually app_name for surreal-commands
        command_name: str,
        command_args: Dict[str, Any],
        context: Optional[Dict[str, Any]] = None,
    ) -> str:
        """Submit a generic command job for background processing"""
        try:
            # Ensure command modules are imported before submitting
            # This is needed because submit_command validates against local registry
            try:
                import commands  # noqa: F401
            except ImportError as import_err:
                logger.error(f"Failed to import command modules: {import_err}")
                raise ValueError("Command modules not available")

            # surreal-commands expects: submit_command(app_name, command_name, args)
            cmd_id = submit_command(
                module_name,  # This is actually the app name (e.g., "open_notebook")
                command_name,  # Command name (e.g., "process_text")
                command_args,  # Input data
            )
            # Convert RecordID to string if needed
            if not cmd_id:
                raise ValueError("Failed to get cmd_id from submit_command")
            cmd_id_str = str(cmd_id)
            logger.info(
                f"Submitted command job: {cmd_id_str} for {module_name}.{command_name}"
            )
            return cmd_id_str

        except Exception as e:
            logger.error(f"Failed to submit command job: {e}")
            raise

    @staticmethod
    async def get_command_status(job_id: str) -> Dict[str, Any]:
        """Get status of any command job"""
        try:
            records = await repo_query(
                "SELECT * FROM $job_id",
                {"job_id": ensure_record_id(job_id)},
            )
            if not records:
                raise ValueError(f"Command {job_id} not found")

            status = CommandService._normalize_command_record(records[0])
            if not status["job_id"]:
                status["job_id"] = job_id
            return status
        except Exception as e:
            logger.error(f"Failed to get command status: {e}")
            raise

    @staticmethod
    async def list_command_jobs(
        module_filter: Optional[str] = None,
        command_filter: Optional[str] = None,
        status_filter: Optional[str] = None,
        limit: int = 50,
    ) -> List[Dict[str, Any]]:
        """List command jobs with optional filtering"""
        try:
            where_clauses: list[str] = []
            vars: Dict[str, Any] = {"limit": limit}

            if module_filter:
                where_clauses.append("app = $module_filter")
                vars["module_filter"] = module_filter
            if command_filter:
                where_clauses.append("name = $command_filter")
                vars["command_filter"] = command_filter
            if status_filter and status_filter != "canceled":
                where_clauses.append("status = $status_filter")
                vars["status_filter"] = status_filter

            query = "SELECT * FROM command"
            if where_clauses:
                query += " WHERE " + " AND ".join(where_clauses)
            query += " ORDER BY created DESC LIMIT $limit"

            records = await repo_query(query, vars)
            jobs = [CommandService._normalize_command_record(record) for record in records]

            if status_filter == "canceled":
                jobs = [job for job in jobs if job["status"] == "canceled"]

            return jobs[:limit]
        except Exception as e:
            logger.error(f"Failed to list command jobs: {e}")
            raise

    @staticmethod
    async def cancel_command_job(job_id: str) -> bool:
        """Cancel a running command job"""
        try:
            records = await repo_query(
                "SELECT * FROM $job_id",
                {"job_id": ensure_record_id(job_id)},
            )
            if not records:
                raise ValueError(f"Command {job_id} not found")

            record = records[0]
            normalized = CommandService._normalize_command_record(record)
            if normalized["status"] in {"completed", "failed", "canceled"}:
                logger.info(f"Command {job_id} already finished with status {normalized['status']}")
                return False

            progress = normalized.get("progress") or {}
            if not isinstance(progress, dict):
                progress = {}
            progress = {
                **progress,
                "phase": "cancel_requested",
                "cancel_requested": True,
            }

            await repo_query(
                """
                UPDATE $job_id MERGE {
                    cancel_requested: true,
                    cancel_requested_at: time::now(),
                    progress: $progress
                }
                """,
                {
                    "job_id": ensure_record_id(job_id),
                    "progress": progress,
                },
            )
            logger.info(f"Marked command {job_id} for cancellation")
            return True
        except Exception as e:
            logger.error(f"Failed to cancel command job: {e}")
            raise
