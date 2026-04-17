#!/usr/bin/env python3
"""
PDF → Markdown → Open Notebook 一键上传工具

用法:
    python scripts/pdf2notebook.py 文件.pdf                          # 转换并上传到默认 notebook
    python scripts/pdf2notebook.py 文件.pdf --notebook NOTEBOOK_ID   # 指定 notebook
    python scripts/pdf2notebook.py 文件.pdf --only-convert           # 只转换不上传
    python scripts/pdf2notebook.py *.pdf                             # 批量处理

图片托管在本地服务器 http://localhost:8888/ 上。
启动图片服务器: bash ./start-images.sh
"""

import argparse
import re
import shutil
import sys
from pathlib import Path

import requests


API_URL = "http://localhost:5055"
API_PASSWORD = "open-notebook-change-me"
IMAGE_SERVER_URL = "http://localhost:8888"
IMAGE_DIR = Path(__file__).resolve().parent / "images"


def get_headers():
    return {
        "Authorization": f"Bearer {API_PASSWORD}",
        "Content-Type": "application/json",
    }


def list_notebooks():
    """列出所有 notebook"""
    resp = requests.get(f"{API_URL}/api/notebooks", headers=get_headers())
    resp.raise_for_status()
    notebooks = resp.json()
    if not notebooks:
        print("没有找到任何 notebook，请先在网页上创建一个。")
        return []
    print("可用的 Notebooks:")
    for nb in notebooks:
        print(f"  {nb['id']}  {nb.get('name', '(无名)')}")
    return notebooks


def convert_pdf(pdf_path: str, output_dir: str = None) -> str:
    """用 Marker 将 PDF 转为 Markdown，返回 markdown 文本"""
    from marker.converters.pdf import PdfConverter
    from marker.models import create_model_dict

    pdf_path = Path(pdf_path)
    if not pdf_path.exists():
        print(f"错误: 文件不存在: {pdf_path}")
        sys.exit(1)

    if output_dir is None:
        output_dir = str(pdf_path.parent / f"{pdf_path.stem}_output")

    print(f"正在转换: {pdf_path.name}")

    converter = PdfConverter(artifact_dict=create_model_dict())
    rendered = converter(str(pdf_path))

    # 保存输出
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    md_text = rendered.markdown

    # 为每篇论文创建图片子目录，避免文件名冲突
    pdf_slug = pdf_path.stem[:60]  # 截断避免路径过长
    img_subdir = IMAGE_DIR / pdf_slug
    img_subdir.mkdir(parents=True, exist_ok=True)

    # 保存图片到本地输出目录和图片服务器目录
    for name, image in rendered.images.items():
        # 保存到输出目录（本地备份）
        img_file = output_path / name
        image.save(str(img_file))
        # 复制到图片服务器目录
        server_img = img_subdir / name
        image.save(str(server_img))

    # 替换图片引用为服务器 URL
    md_text = replace_images_with_urls(md_text, pdf_slug)

    # 保存 markdown
    md_file = output_path / f"{pdf_path.stem}.md"
    md_file.write_text(md_text, encoding="utf-8")

    print(f"转换完成: {len(md_text)} 字符, 保存在 {md_file}")
    return md_text, pdf_path.stem


def replace_images_with_urls(md_text: str, pdf_slug: str) -> str:
    """将 Markdown 中的本地图片引用替换为服务器 URL"""
    def replace_image(match):
        alt_text = match.group(1)
        img_path_str = match.group(2)

        # 跳过已经是 URL 的
        if img_path_str.startswith(("http://", "https://", "data:")):
            return match.group(0)

        img_name = Path(img_path_str).name
        url = f"{IMAGE_SERVER_URL}/{pdf_slug}/{img_name}"
        print(f"  图片: {img_name} → {url}")
        return f"![{alt_text}]({url})"

    return re.sub(r"!\[([^\]]*)\]\(([^)]+)\)", replace_image, md_text)


def upload_to_notebook(title: str, content: str, notebook_id: str = None):
    """上传 markdown 内容到 Open Notebook"""
    payload = {
        "type": "text",
        "title": title,
        "content": content,
        "embed": True,
        "async_processing": True,
    }
    if notebook_id:
        payload["notebooks"] = [notebook_id]

    resp = requests.post(
        f"{API_URL}/api/sources/json",
        headers=get_headers(),
        json=payload,
    )

    if resp.status_code == 200:
        data = resp.json()
        source_id = data.get("id", "unknown")
        print(f"上传成功: {title} (ID: {source_id})")
        return data
    else:
        print(f"上传失败 [{resp.status_code}]: {resp.text}")
        return None


def main():
    parser = argparse.ArgumentParser(description="PDF → Markdown → Open Notebook")
    parser.add_argument("files", nargs="+", help="PDF 文件路径")
    parser.add_argument("--notebook", "-n", help="Notebook ID (不指定则列出可选项)")
    parser.add_argument("--only-convert", action="store_true", help="只转换为 Markdown，不上传")
    parser.add_argument("--list", action="store_true", help="列出所有 notebooks")
    args = parser.parse_args()

    if args.list:
        list_notebooks()
        return

    notebook_id = args.notebook

    # 如果没指定 notebook 且需要上传，先列出让用户选
    if not args.only_convert and not notebook_id:
        notebooks = list_notebooks()
        if not notebooks:
            print("错误: 没有可用的 notebook，请先在网页上创建一个。")
            return
        if len(notebooks) == 1:
            notebook_id = notebooks[0]["id"]
            print(f"自动选择唯一的 notebook: {notebooks[0].get('name', notebook_id)}")
        else:
            for i, nb in enumerate(notebooks, 1):
                print(f"  [{i}] {nb.get('name', '(无名)')}  ({nb['id']})")
            idx = input("请输入序号 (从 1 开始): ").strip()
            try:
                notebook_id = notebooks[int(idx) - 1]["id"]
            except (ValueError, IndexError):
                print("无效选择")
                return
        print(f"将上传到: {notebook_id}\n")

    for pdf_file in args.files:
        print(f"\n{'='*50}")
        md_text, title = convert_pdf(pdf_file)

        if args.only_convert:
            print(f"跳过上传 (--only-convert)")
            continue

        upload_to_notebook(title, md_text, notebook_id)

    print(f"\n全部完成!")


if __name__ == "__main__":
    main()
