# 使用 Playwright 官方镜像作为基础，包含所有浏览器依赖
FROM mcr.microsoft.com/playwright/python:v1.48.0-jammy

WORKDIR /app

# 设置环境变量
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONPATH=/app

# 安装系统依赖 (如果有额外需要)
RUN apt-get update && apt-get install -y \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# 复制依赖文件
COPY pyproject.toml .

# 安装 Python 依赖
# 注意: Playwright 镜像里已经有 python 环境
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir .

# 安装 Crawl4AI 可能需要的额外浏览器依赖 (通常 Playwright 镜像已经包含，但 Crawl4AI 可能有特定要求)
# 暂时跳过，如果运行报错再加

# 复制应用代码
COPY app ./app
COPY main.py .

# 暴露端口
EXPOSE 8001

# 启动命令
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001", "--reload"]
