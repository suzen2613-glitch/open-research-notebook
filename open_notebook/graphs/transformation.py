from ai_prompter import Prompter
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_core.runnables import RunnableConfig
from langgraph.graph import END, START, StateGraph
from typing_extensions import NotRequired, TypedDict

from open_notebook.ai.provision import provision_langchain_model
from open_notebook.domain.notebook import Source
from open_notebook.domain.transformation import DefaultPrompts, Transformation
from open_notebook.exceptions import OpenNotebookError
from open_notebook.utils import clean_thinking_content
from open_notebook.utils.error_classifier import classify_error
from open_notebook.utils.source_evidence import format_source_evidence
from open_notebook.utils.text_utils import extract_text_content


class TransformationState(TypedDict):
    input_text: str
    source: Source
    transformation: Transformation
    output: str
    transformation_id: NotRequired[str | None]
    insight_title: NotRequired[str | None]
    prompt_override: NotRequired[str | None]
    evidence_context: NotRequired[str]


async def run_transformation(state: dict, config: RunnableConfig) -> dict:
    source_obj = state.get("source")
    source: Source = source_obj if isinstance(source_obj, Source) else None  # type: ignore[assignment]
    content = state.get("input_text")
    assert source or content, "No content to transform"
    transformation: Transformation = state["transformation"]

    try:
        if not content:
            content = source.full_text
        prompt_override = state.get("prompt_override")
        transformation_template_text = prompt_override or transformation.prompt
        prompt_snapshot = transformation_template_text
        insight_title = state.get("insight_title") or transformation.title
        transformation_id = state.get("transformation_id")
        if transformation_id is None:
            transformation_id = getattr(transformation, "id", None)
        default_prompts: DefaultPrompts = await DefaultPrompts.get_instance()  # type: ignore[assignment]
        default_instructions = (default_prompts.transformation_instructions or "").strip()
        if default_instructions:
            transformation_template_text = (
                f"{default_instructions}\n\n{transformation_template_text}"
            )

        transformation_template_text = f"{transformation_template_text}\n\n# INPUT"
        render_state = dict(state)
        if source and source.id:
            evidence_chunks = await source.get_embeddings(limit=12)
            render_state["evidence_context"] = format_source_evidence(evidence_chunks)
        else:
            render_state["evidence_context"] = (
                "No structured evidence excerpts are available for this source."
            )

        system_prompt = Prompter(template_text=transformation_template_text).render(
            data=render_state
        )
        content_str = str(content) if content else ""
        payload = [SystemMessage(content=system_prompt), HumanMessage(content=content_str)]
        chain = await provision_langchain_model(
            str(payload),
            config.get("configurable", {}).get("model_id"),
            "transformation",
            max_tokens=8192,
        )

        response = await chain.ainvoke(payload)

        # Clean thinking content from the response
        response_content = extract_text_content(response.content)
        cleaned_content = clean_thinking_content(response_content)

        if source:
            await source.add_insight(
                insight_title,
                cleaned_content,
                transformation_id=transformation_id,
                prompt_title=insight_title,
                prompt_snapshot=prompt_snapshot,
            )

        return {
            "output": cleaned_content,
        }
    except OpenNotebookError:
        raise
    except Exception as e:
        error_class, user_message = classify_error(e)
        raise error_class(user_message) from e


agent_state = StateGraph(TransformationState)
agent_state.add_node("agent", run_transformation)  # type: ignore[type-var]
agent_state.add_edge(START, "agent")
agent_state.add_edge("agent", END)
graph = agent_state.compile()
