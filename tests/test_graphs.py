"""
Unit tests for the open_notebook.graphs module.

This test suite focuses on testing graph structures, tools, and validation
without heavy mocking of the actual processing logic.
"""

from datetime import datetime

import pytest

from open_notebook.graphs.prompt import PatternChainState, graph
from open_notebook.graphs.tools import get_current_timestamp
from open_notebook.graphs.transformation import (
    TransformationState,
    run_transformation,
)
from open_notebook.graphs.transformation import (
    graph as transformation_graph,
)

# ============================================================================
# TEST SUITE 1: Graph Tools
# ============================================================================


class TestGraphTools:
    """Test suite for graph tool definitions."""

    def test_get_current_timestamp_format(self):
        """Test timestamp tool returns correct format."""
        timestamp = get_current_timestamp.func()

        assert isinstance(timestamp, str)
        assert len(timestamp) == 14  # YYYYMMDDHHmmss format
        assert timestamp.isdigit()

    def test_get_current_timestamp_validity(self):
        """Test timestamp represents valid datetime."""
        timestamp = get_current_timestamp.func()

        # Parse it back to datetime to verify validity
        year = int(timestamp[0:4])
        month = int(timestamp[4:6])
        day = int(timestamp[6:8])
        hour = int(timestamp[8:10])
        minute = int(timestamp[10:12])
        second = int(timestamp[12:14])

        # Should be valid date components
        assert 2020 <= year <= 2100
        assert 1 <= month <= 12
        assert 1 <= day <= 31
        assert 0 <= hour <= 23
        assert 0 <= minute <= 59
        assert 0 <= second <= 59

        # Should parse as datetime
        dt = datetime.strptime(timestamp, "%Y%m%d%H%M%S")
        assert isinstance(dt, datetime)

    def test_get_current_timestamp_is_tool(self):
        """Test that function is properly decorated as a tool."""
        # Check it has tool attributes
        assert hasattr(get_current_timestamp, "name")
        assert hasattr(get_current_timestamp, "description")


# ============================================================================
# TEST SUITE 2: Prompt Graph State
# ============================================================================


class TestPromptGraph:
    """Test suite for prompt pattern chain graph."""

    def test_pattern_chain_state_structure(self):
        """Test PatternChainState structure and fields."""
        state = PatternChainState(
            prompt="Test prompt", parser=None, input_text="Test input", output=""
        )

        assert state["prompt"] == "Test prompt"
        assert state["parser"] is None
        assert state["input_text"] == "Test input"
        assert state["output"] == ""

    def test_prompt_graph_compilation(self):
        """Test that prompt graph compiles correctly."""
        assert graph is not None

        # Graph should have the expected structure
        assert hasattr(graph, "invoke")
        assert hasattr(graph, "ainvoke")


# ============================================================================
# TEST SUITE 3: Transformation Graph
# ============================================================================


class TestTransformationGraph:
    """Test suite for transformation graph workflows."""

    def test_transformation_state_structure(self):
        """Test TransformationState structure and fields."""
        from unittest.mock import MagicMock

        from open_notebook.domain.notebook import Source
        from open_notebook.domain.transformation import Transformation

        mock_source = MagicMock(spec=Source)
        mock_transformation = MagicMock(spec=Transformation)

        state = TransformationState(
            input_text="Test text",
            source=mock_source,
            transformation=mock_transformation,
            output="",
        )

        assert state["input_text"] == "Test text"
        assert state["source"] == mock_source
        assert state["transformation"] == mock_transformation
        assert state["output"] == ""

    @pytest.mark.asyncio
    async def test_run_transformation_assertion_no_content(self):
        """Test transformation raises assertion with no content."""
        from unittest.mock import MagicMock

        from open_notebook.domain.transformation import Transformation

        mock_transformation = MagicMock(spec=Transformation)

        state = {
            "input_text": None,
            "transformation": mock_transformation,
            "source": None,
        }

        config = {"configurable": {"model_id": None}}

        with pytest.raises(AssertionError, match="No content to transform"):
            await run_transformation(state, config)

    @pytest.mark.asyncio
    async def test_run_transformation_applies_default_prompt(self, monkeypatch):
        """Test transformation prepends default instructions from the database."""
        from types import SimpleNamespace
        from unittest.mock import AsyncMock, MagicMock

        import open_notebook.graphs.transformation as transformation_module

        captured: dict[str, str] = {}

        async def fake_provision_langchain_model(*args, **kwargs):
            class DummyChain:
                async def ainvoke(self, payload):
                    captured["system_prompt"] = payload[0].content
                    return SimpleNamespace(content="Summarized output")

            return DummyChain()

        monkeypatch.setattr(
            transformation_module.DefaultPrompts,
            "get_instance",
            AsyncMock(
                return_value=SimpleNamespace(
                    transformation_instructions="GLOBAL RULES"
                )
            ),
        )
        monkeypatch.setattr(
            transformation_module,
            "provision_langchain_model",
            fake_provision_langchain_model,
        )
        monkeypatch.setattr(
            transformation_module, "extract_text_content", lambda content: content
        )
        monkeypatch.setattr(
            transformation_module, "clean_thinking_content", lambda content: content
        )

        mock_transformation = MagicMock()
        mock_transformation.prompt = "LOCAL PROMPT"
        mock_transformation.title = "Paper Analysis"

        result = await transformation_module.run_transformation(
            {
                "input_text": "Paper text",
                "transformation": mock_transformation,
                "source": None,
            },
            {"configurable": {"model_id": "model:test"}},
        )

        assert result["output"] == "Summarized output"
        assert "GLOBAL RULES" in captured["system_prompt"]
        assert "LOCAL PROMPT" in captured["system_prompt"]
        assert captured["system_prompt"].endswith("# INPUT")

    @pytest.mark.asyncio
    async def test_run_transformation_stores_prompt_metadata(self, monkeypatch):
        """Test transformation persists prompt metadata with the generated insight."""
        from types import SimpleNamespace
        from unittest.mock import AsyncMock

        import open_notebook.graphs.transformation as transformation_module
        from open_notebook.domain.notebook import Source

        async def fake_provision_langchain_model(*args, **kwargs):
            class DummyChain:
                async def ainvoke(self, payload):
                    return SimpleNamespace(content="Summarized output")

            return DummyChain()

        monkeypatch.setattr(
            transformation_module.DefaultPrompts,
            "get_instance",
            AsyncMock(return_value=SimpleNamespace(transformation_instructions="")),
        )
        monkeypatch.setattr(
            transformation_module,
            "provision_langchain_model",
            fake_provision_langchain_model,
        )
        monkeypatch.setattr(
            transformation_module, "extract_text_content", lambda content: content
        )
        monkeypatch.setattr(
            transformation_module, "clean_thinking_content", lambda content: content
        )

        source = Source(id="source:test", title="Test Source", topics=[])
        captured: dict[str, object] = {}

        async def fake_add_insight(self, insight_type, content, **kwargs):
            captured["insight_type"] = insight_type
            captured["content"] = content
            captured["kwargs"] = kwargs

        monkeypatch.setattr(Source, "add_insight", fake_add_insight)

        await transformation_module.run_transformation(
            {
                "input_text": "Paper text",
                "source": source,
                "transformation": SimpleNamespace(
                    id="transformation:test",
                    title="Paper Analysis",
                    prompt="LOCAL PROMPT",
                ),
            },
            {"configurable": {"model_id": "model:test"}},
        )

        assert captured == {
            "insight_type": "Paper Analysis",
            "content": "Summarized output",
            "kwargs": {
                "transformation_id": "transformation:test",
                "prompt_title": "Paper Analysis",
                "prompt_snapshot": "LOCAL PROMPT",
            },
        }

    def test_transformation_graph_compilation(self):
        """Test that transformation graph compiles correctly."""
        assert transformation_graph is not None
        assert hasattr(transformation_graph, "invoke")
        assert hasattr(transformation_graph, "ainvoke")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
