# 使用 Playwright 官方镜像作为基础，包含 Python 和核心系统依赖
FROM mcr.microsoft.com/playwright/python:v1.48.0-jammy

WORKDIR /app

# 设置环境变量
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONPATH=/app

# 安装必要的系统工具
RUN apt-get update && apt-get install -y \
    build-essential \
    curl \
    && rm -rf /var/lib/apt/lists/*

# 复制依赖文件
COPY pyproject.toml .

# 安装 Python 依赖
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir .

# --- 关键步骤：安装浏览器及系统依赖 ---
# 虽然基础镜像是 Playwright，但显式运行 install 确保版本对齐，
# 并且 install-deps 确保在任何 Linux 变体下都具备运行环境。
RUN playwright install chromium && \
    playwright install-deps chromium

# 复制应用代码
COPY app ./app
COPY main.py .

# 暴露 Scout 服务端口
EXPOSE 8001

# 启动命令
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]