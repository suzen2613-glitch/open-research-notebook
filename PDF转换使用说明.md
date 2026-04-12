# PDF → Markdown → Open Notebook 转换工具使用说明

## 功能简介

这个脚本可以将 PDF 文件转换为 Markdown 格式，并自动上传到 Open Notebook 知识库。使用 Marker 深度学习模型进行高质量转换，支持公式、表格、图片识别。

## 前置条件

1. **启动 Open Notebook 所有服务**：
   ```bash
   bash ~/Downloads/open-notebook/start.sh
   ```
   这会启动 5 个服务：SurrealDB、API、Worker、图片服务器、前端

2. **确认图片服务器运行**（端口 8888）：
   ```bash
   curl http://localhost:8888/
   ```
   如果返回 HTML 目录列表，说明正常运行

3. **激活 conda 环境**：
   ```bash
   conda activate open-notebook
   ```

## 基本用法

### 1. 转换单个 PDF 并上传

```bash
python ~/Downloads/open-notebook/pdf2notebook.py 论文.pdf
```

**执行流程**：
- 列出所有可用的 notebook
- 如果只有 1 个，自动选择
- 如果有多个，提示你输入序号选择
- 转换 PDF → Markdown
- 上传到选定的 notebook

### 2. 指定 notebook ID 上传

```bash
python ~/Downloads/open-notebook/pdf2notebook.py 论文.pdf --notebook notebook:abc123
```

跳过选择步骤，直接上传到指定 notebook。

**如何获取 notebook ID**：
- 方法 1：运行 `python pdf2notebook.py --list` 查看
- 方法 2：在网页上打开 notebook，URL 中的 ID 就是（如 `http://localhost:3000/notebooks/notebook:xyz`）

### 3. 只转换不上传

```bash
python ~/Downloads/open-notebook/pdf2notebook.py 论文.pdf --only-convert
```

**输出位置**：
- Markdown 文件：`论文_output/论文.md`
- 图片文件：`论文_output/*.png`
- 图片服务器副本：`~/Downloads/open-notebook/images/论文/*.png`

### 4. 批量转换多个 PDF

```bash
python ~/Downloads/open-notebook/pdf2notebook.py *.pdf
```

或指定多个文件：
```bash
python ~/Downloads/open-notebook/pdf2notebook.py 论文1.pdf 论文2.pdf 论文3.pdf
```

所有文件会上传到同一个 notebook。

### 5. 列出所有 notebook

```bash
python ~/Downloads/open-notebook/pdf2notebook.py --list
```

输出示例：
```
可用的 Notebooks:
  notebook:abc123  机器学习论文集
  notebook:def456  物理学笔记
```

## 参数说明

| 参数 | 简写 | 说明 | 示例 |
|------|------|------|------|
| `files` | - | PDF 文件路径（必需） | `paper.pdf` 或 `*.pdf` |
| `--notebook` | `-n` | 指定 notebook ID | `--notebook notebook:abc123` |
| `--only-convert` | - | 只转换不上传 | `--only-convert` |
| `--list` | - | 列出所有 notebook | `--list` |

## 输出文件结构

转换后会生成两个位置的文件：

### 1. 本地输出目录（`{PDF名}_output/`）
```
论文_output/
├── 论文.md          # Markdown 文件（图片引用为 URL）
├── image_1.png      # 提取的图片
├── image_2.png
└── ...
```

### 2. 图片服务器目录（`~/Downloads/open-notebook/images/`）
```
images/
└── 论文/            # 以 PDF 文件名命名的子目录
    ├── image_1.png
    ├── image_2.png
    └── ...
```

Markdown 中的图片引用格式：
```markdown
![图片描述](http://localhost:8888/论文/image_1.png)
```

## 常见问题

### Q1: 提示 "没有找到任何 notebook"

**原因**：你还没有在 Open Notebook 网页上创建 notebook。

**解决**：
1. 打开浏览器访问 http://localhost:3000
2. 点击 "New Notebook" 创建一个
3. 重新运行脚本

### Q2: 图片在 Open Notebook 中不显示

**原因**：图片服务器没有启动。

**解决**：
```bash
# 检查图片服务器是否运行
curl http://localhost:8888/

# 如果没有响应，手动启动
bash ~/Downloads/open-notebook/start-images.sh

# 或者重启所有服务
bash ~/Downloads/open-notebook/stop.sh
bash ~/Downloads/open-notebook/start.sh
```

### Q3: 转换速度很慢

**原因**：Marker 使用深度学习模型，首次运行会下载模型（约 1-2GB），后续运行会快很多。

**提示**：
- 首次转换可能需要 5-10 分钟（下载模型）
- 后续每页约 1-2 秒
- 如果有 GPU，速度会更快

### Q4: 上传后在网页上看不到内容

**原因**：后台 Worker 正在处理（提取文本、生成 embedding）。

**解决**：
1. 刷新网页，查看来源状态
2. 如果显示 "正在处理"，等待 1-2 分钟
3. 如果一直卡住，检查 Worker 是否运行：
   ```bash
   pgrep -f "surreal-commands-worker"
   ```
   如果没有输出，重启服务：
   ```bash
   bash ~/Downloads/open-notebook/stop.sh
   bash ~/Downloads/open-notebook/start.sh
   ```

### Q5: 提示 "Connection refused" 或 "API 无法访问"

**原因**：Open Notebook 服务没有启动。

**解决**：
```bash
bash ~/Downloads/open-notebook/start.sh
```

等待所有服务启动完成（约 10-15 秒），然后重新运行脚本。

## 完整示例

### 示例 1：转换单篇论文

```bash
cd ~/Downloads/papers
python ~/Downloads/open-notebook/pdf2notebook.py "Deep Learning Survey.pdf"
```

**输出**：
```
可用的 Notebooks:
  [1] AI 论文集  (notebook:abc123)
  [2] 综述文献  (notebook:def456)
请输入序号 (从 1 开始): 1
将上传到: notebook:abc123

==================================================
正在转换: Deep Learning Survey.pdf
  图片: image_1.png → http://localhost:8888/Deep_Learning_Survey/image_1.png
  图片: image_2.png → http://localhost:8888/Deep_Learning_Survey/image_2.png
转换完成: 45230 字符, 保存在 Deep Learning Survey_output/Deep Learning Survey.md
上传成功: Deep Learning Survey (ID: source:xyz789)

全部完成!
```

### 示例 2：批量转换文件夹中的所有 PDF

```bash
cd ~/Downloads/papers
python ~/Downloads/open-notebook/pdf2notebook.py *.pdf --notebook notebook:abc123
```

### 示例 3：只转换不上传（用于检查质量）

```bash
python ~/Downloads/open-notebook/pdf2notebook.py test.pdf --only-convert
cat test_output/test.md  # 查看转换结果
```

## 高级技巧

### 1. 自定义输出目录

修改脚本第 62 行：
```python
output_dir = "/path/to/custom/output"
```

### 2. 修改 API 密码

如果你修改了 Open Notebook 的 API 密码，编辑脚本第 25 行：
```python
API_PASSWORD = "你的新密码"
```

### 3. 使用不同的图片服务器端口

如果 8888 端口被占用，修改：
1. 脚本第 26 行：`IMAGE_SERVER_URL = "http://localhost:新端口"`
2. `start-images.sh` 中的端口号
3. 重启图片服务器

## 脚本位置

- **脚本文件**：`~/Downloads/open-notebook/pdf2notebook.py`
- **启动脚本**：`~/Downloads/open-notebook/start.sh`
- **停止脚本**：`~/Downloads/open-notebook/stop.sh`
- **图片目录**：`~/Downloads/open-notebook/images/`

## 相关命令

```bash
# 启动所有服务
bash ~/Downloads/open-notebook/start.sh

# 停止所有服务
bash ~/Downloads/open-notebook/stop.sh

# 查看服务状态
pgrep -f "surreal start"        # SurrealDB
pgrep -f "uvicorn"              # API
pgrep -f "surreal-commands"     # Worker
pgrep -f "http.server 8888"     # 图片服务器
pgrep -f "npm run dev"          # 前端

# 查看日志
tail -f /tmp/surrealdb.log
tail -f /tmp/open-notebook-api.log
tail -f /tmp/open-notebook-worker.log
tail -f /tmp/open-notebook-images.log
tail -f /tmp/open-notebook-frontend.log
```

## 技术细节

- **转换引擎**：Marker (https://github.com/VikParuchuri/marker)
- **OCR 模型**：Surya OCR（支持 90+ 语言）
- **公式识别**：LaTeX 格式输出
- **表格识别**：保留结构的 Markdown 表格
- **图片处理**：自动提取并托管在本地服务器
- **上传方式**：通过 Open Notebook API (`POST /api/sources/json`)
- **异步处理**：上传后后台自动生成 embedding 和索引
