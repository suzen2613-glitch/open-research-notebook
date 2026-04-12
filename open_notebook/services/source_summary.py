from textwrap import dedent


SOURCE_SUMMARY_TITLE = "Summary"

SOURCE_SUMMARY_PROMPT = dedent(
    """
    你是一位拥有10年以上经验的领域顶级研究员和学术论文审稿人。请用严谨、客观、专业的学术语言，对以下论文进行全面总结。

    要求：
    - 严格基于论文原文内容，绝不要添加任何论文中没有的信息、外部知识或个人推测。
    - 若论文未明确提供某项信息，请明确写“原文未说明”，不要推断。
    - 保持中立客观，不夸大也不弱化任何结论。
    - 技术术语保留原文准确性，必要时可加简短解释。
    - 总结长度控制在1200-1800字左右，可根据论文复杂度适当调整，语言精炼、逻辑清晰。

    请严格按照以下结构输出总结，每个部分都使用对应标题：

    1. **论文基本信息**
       标题、所有作者、发表期刊/会议/年份；若原文未明确给出，请写“原文未说明”。

    2. **研究背景与核心问题**
       这项研究试图解决什么实际或理论问题？背景和动机是什么？

    3. **研究创新点/贡献**
       用 bullet points 列出 2-4 条最主要的创新或贡献。

    4. **研究方法**
       详细描述采用的技术路线、模型或算法、数据集、实验设计等，保持技术准确性。

    5. **主要结果与发现**
       用 bullet points 呈现最核心的实验结果、数据和图表关键结论。

    6. **结论与意义**
       作者得出了什么主要结论？对该领域的理论或实践意义是什么？

    7. **局限性与未来工作**
       论文中明确提到的局限性，以及作者建议的未来研究方向。

    8. **研究定位与综合评价（可选）**
       仅基于论文自身内容，概括其研究价值、适用场景和完成度，不引用外部评价。
    """
).strip()


def is_source_summary_marker(
    insight_type: str | None = None, prompt_title: str | None = None
) -> bool:
    marker = SOURCE_SUMMARY_TITLE.casefold()
    return any(
        value and value.strip().casefold() == marker
        for value in (insight_type, prompt_title)
    )
