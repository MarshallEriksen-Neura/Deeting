#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import secrets
import subprocess
import sys
import uuid
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse


@dataclass
class ProbeResult:
    name: str
    http_code: str
    total_seconds: float | None
    body: str
    curl_exit_code: int
    stderr: str


def run_cmd(
    cmd: list[str],
    *,
    input_text: str | None = None,
    check: bool = True,
) -> subprocess.CompletedProcess[str]:
    proc = subprocess.run(
        cmd,
        input=input_text,
        text=True,
        capture_output=True,
        check=False,
    )
    if check and proc.returncode != 0:
        raise RuntimeError(
            f"command failed ({proc.returncode}): {' '.join(cmd)}\n"
            f"stdout: {proc.stdout}\n"
            f"stderr: {proc.stderr}"
        )
    return proc


def parse_env_file(env_path: Path) -> dict[str, str]:
    result: dict[str, str] = {}
    if not env_path.exists():
        return result
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if (
            len(value) >= 2
            and ((value.startswith('"') and value.endswith('"')) or (value.startswith("'") and value.endswith("'")))
        ):
            value = value[1:-1]
        result[key] = value
    return result


def list_docker_containers() -> list[tuple[str, str]]:
    proc = run_cmd(
        ["docker", "ps", "--format", "{{.ID}}\t{{.Names}}"],
        check=True,
    )
    items: list[tuple[str, str]] = []
    for line in proc.stdout.splitlines():
        parts = line.strip().split("\t", 1)
        if len(parts) == 2 and parts[0] and parts[1]:
            items.append((parts[0], parts[1]))
    return items


def pick_container(containers: list[tuple[str, str]], *, preferred_name: str | None, match_substr: str) -> str:
    if preferred_name:
        return preferred_name
    for _cid, name in containers:
        if match_substr in name:
            return name
    raise RuntimeError(f"cannot find running container matching '{match_substr}'")


def parse_redis_password(redis_url: str) -> str:
    parsed = urlparse(redis_url)
    return parsed.password or ""


def write_token_to_redis(
    *,
    redis_container: str,
    redis_password: str,
    key: str,
    claims_json: str,
    max_calls: int,
    ttl_seconds: int,
) -> None:
    base = ["docker", "exec", redis_container, "redis-cli"]
    if redis_password:
        base.extend(["-a", redis_password])
    run_cmd(
        base
        + [
            "HSET",
            key,
            "claims_json",
            claims_json,
            "used_calls",
            "0",
            "max_calls",
            str(max_calls),
        ],
        check=True,
    )
    run_cmd(base + ["EXPIRE", key, str(ttl_seconds)], check=True)


def delete_token_in_redis(
    *,
    redis_container: str,
    redis_password: str,
    key: str,
) -> None:
    base = ["docker", "exec", redis_container, "redis-cli"]
    if redis_password:
        base.extend(["-a", redis_password])
    run_cmd(base + ["DEL", key], check=False)


def _parse_curl_metrics(output: str) -> tuple[str, float | None]:
    http_code = "000"
    total = None
    code_match = re.search(r"HTTP_CODE:(\d+)", output)
    if code_match:
        http_code = code_match.group(1)
    total_match = re.search(r"TOTAL:([0-9.]+)", output)
    if total_match:
        try:
            total = float(total_match.group(1))
        except ValueError:
            total = None
    return http_code, total


def run_probe(
    *,
    sandbox_container: str,
    endpoint: str,
    name: str,
    method: str,
    timeout_seconds: int,
    payload: dict | None = None,
    token: str | None = None,
) -> ProbeResult:
    payload_path = f"/tmp/{name}.payload.json"
    body_path = f"/tmp/{name}.body.json"
    if payload is not None:
        run_cmd(
            ["docker", "exec", "-i", sandbox_container, "sh", "-lc", f"cat > {payload_path}"],
            input_text=json.dumps(payload, ensure_ascii=False),
            check=True,
        )

    curl_cmd = [
        "docker",
        "exec",
        sandbox_container,
        "curl",
        "-sS",
        "-m",
        str(timeout_seconds),
        "-o",
        body_path,
        "-w",
        "HTTP_CODE:%{http_code}\nTOTAL:%{time_total}\n",
        "-X",
        method.upper(),
        endpoint,
        "-H",
        "Content-Type: application/json",
    ]
    if token:
        curl_cmd.extend(["-H", f"X-Code-Mode-Execution-Token: {token}"])
    if payload is not None:
        curl_cmd.extend(["--data-binary", f"@{payload_path}"])

    proc = run_cmd(curl_cmd, check=False)
    metrics_source = f"{proc.stdout}\n{proc.stderr}"
    http_code, total = _parse_curl_metrics(metrics_source)

    body_proc = run_cmd(
        ["docker", "exec", sandbox_container, "cat", body_path],
        check=False,
    )
    body = body_proc.stdout.strip()
    return ProbeResult(
        name=name,
        http_code=http_code,
        total_seconds=total,
        body=body,
        curl_exit_code=proc.returncode,
        stderr=proc.stderr.strip(),
    )


def run_local_scout_probe(
    *,
    scout_service_url: str,
    target_url: str,
    timeout_seconds: int,
) -> ProbeResult:
    body_path = "/tmp/bridge_smoke_scout.body.json"
    payload = json.dumps({"url": target_url, "js_mode": True}, ensure_ascii=False)
    endpoint = f"{scout_service_url.rstrip('/')}/v1/scout/inspect"
    cmd = [
        "curl",
        "-sS",
        "-m",
        str(timeout_seconds),
        "-o",
        body_path,
        "-w",
        "HTTP_CODE:%{http_code}\nTOTAL:%{time_total}\n",
        "-X",
        "POST",
        endpoint,
        "-H",
        "Content-Type: application/json",
        "--data-binary",
        payload,
    ]
    proc = run_cmd(cmd, check=False)
    metrics_source = f"{proc.stdout}\n{proc.stderr}"
    http_code, total = _parse_curl_metrics(metrics_source)
    body_proc = run_cmd(["cat", body_path], check=False)
    return ProbeResult(
        name="direct_scout_inspect",
        http_code=http_code,
        total_seconds=total,
        body=body_proc.stdout.strip(),
        curl_exit_code=proc.returncode,
        stderr=proc.stderr.strip(),
    )


def format_seconds(value: float | None) -> str:
    if value is None:
        return "-"
    return f"{value:.3f}s"


def analyze(
    *,
    get_result: ProbeResult,
    no_token_result: ProbeResult,
    unknown_tool_result: ProbeResult,
    target_tool_result: ProbeResult,
    direct_scout_result: ProbeResult | None = None,
) -> list[str]:
    findings: list[str] = []
    if get_result.http_code == "000":
        findings.append("容器到 bridge endpoint 网络不可达或连接超时。")
        return findings

    if get_result.http_code == "405" and no_token_result.http_code == "401":
        findings.append("bridge 路径连通正常，且服务端鉴权逻辑生效。")
    else:
        findings.append(
            f"基础连通异常：GET={get_result.http_code}, POST(no token)={no_token_result.http_code}。"
        )

    if unknown_tool_result.http_code == "200" and (unknown_tool_result.total_seconds or 0) < 2:
        findings.append("带 token 的桥接调用可快速返回，说明 token 消费与 dispatch 主链路正常。")
    elif unknown_tool_result.http_code == "000":
        findings.append("带 token 调用在网关阶段超时，优先排查网桥地址或网关负载。")
    else:
        findings.append(f"带 token 基线调用异常：HTTP {unknown_tool_result.http_code}。")

    body_lower = (target_tool_result.body or "").lower()
    if target_tool_result.http_code == "000":
        findings.append("目标工具调用在容器侧 curl 超时，说明请求在网关/工具执行阶段卡住。")
    elif "err_timed_out" in body_lower or "timed out" in body_lower:
        findings.append("超时发生在工具内部上游访问（bridge 已通，不是 endpoint 不通）。")
    elif target_tool_result.http_code in {"401", "403", "429"}:
        findings.append(f"目标工具被鉴权/限流拒绝：HTTP {target_tool_result.http_code}。")
    else:
        findings.append(f"目标工具返回 HTTP {target_tool_result.http_code}，需结合 body 继续判断。")

    if direct_scout_result:
        scout_body = (direct_scout_result.body or "").lower()
        if direct_scout_result.http_code == "200" and ("err_timed_out" in scout_body or "timed out" in scout_body):
            findings.append("直连 Scout 也出现相同超时，根因在 Scout/crawl4ai，而非 bridge。")
        elif direct_scout_result.http_code == "000":
            findings.append("直连 Scout 不可达，需先排查 SCOUT_SERVICE_URL。")
    return findings


def main() -> int:
    parser = argparse.ArgumentParser(description="Code Mode Bridge 容器内冒烟脚本")
    parser.add_argument("--endpoint", default="", help="bridge call endpoint，默认读取 backend/.env")
    parser.add_argument("--sandbox-container", default="", help="sandbox 容器名（默认自动匹配 sandbox-）")
    parser.add_argument("--redis-container", default="", help="redis 容器名（默认自动匹配 redis）")
    parser.add_argument("--tool", default="fetch_web_content", help="要调用的工具名")
    parser.add_argument(
        "--args-json",
        default='{"url":"https://example.com"}',
        help="工具 arguments 的 JSON 字符串",
    )
    parser.add_argument("--timeout-seconds", type=int, default=20, help="容器内 curl 超时秒数")
    parser.add_argument("--token-ttl-seconds", type=int, default=300, help="临时 token TTL")
    parser.add_argument("--token-max-calls", type=int, default=4, help="临时 token 最大调用次数")
    parser.add_argument("--keep-token", action="store_true", help="是否保留 redis 里的临时 token")
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[1]
    env_file = repo_root / ".env"
    env_data = parse_env_file(env_file)

    endpoint = (args.endpoint or env_data.get("CODE_MODE_BRIDGE_ENDPOINT", "")).strip()
    if not endpoint:
        raise RuntimeError("missing endpoint: set --endpoint or CODE_MODE_BRIDGE_ENDPOINT in backend/.env")
    redis_url = env_data.get("REDIS_URL", "").strip()
    if not redis_url:
        raise RuntimeError("missing REDIS_URL in backend/.env")
    cache_prefix = env_data.get("CACHE_PREFIX", "ai_gateway:").strip().strip('"').strip("'")
    if not cache_prefix:
        cache_prefix = "ai_gateway:"
    scout_service_url = env_data.get("SCOUT_SERVICE_URL", "").strip().strip('"').strip("'")

    try:
        tool_args = json.loads(args.args_json)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"--args-json is invalid JSON: {exc}") from exc
    if not isinstance(tool_args, dict):
        raise RuntimeError("--args-json must be a JSON object")

    containers = list_docker_containers()
    sandbox_container = pick_container(
        containers,
        preferred_name=args.sandbox_container or None,
        match_substr="sandbox-",
    )
    redis_container = pick_container(
        containers,
        preferred_name=args.redis_container or None,
        match_substr="redis",
    )
    redis_password = parse_redis_password(redis_url)

    token = secrets.token_urlsafe(32)
    claims = {
        "user_id": str(uuid.uuid4()),
        "session_id": f"smoke-{uuid.uuid4().hex[:8]}",
        "capability": "skill_runtime",
        "max_calls": int(args.token_max_calls),
        "scopes": [],
        "allowed_models": [],
    }
    redis_key = f"{cache_prefix}code_mode:runtime_bridge:{token}"
    write_token_to_redis(
        redis_container=redis_container,
        redis_password=redis_password,
        key=redis_key,
        claims_json=json.dumps(claims, ensure_ascii=False),
        max_calls=int(args.token_max_calls),
        ttl_seconds=int(args.token_ttl_seconds),
    )

    get_result = run_probe(
        sandbox_container=sandbox_container,
        endpoint=endpoint,
        name="bridge_get",
        method="GET",
        timeout_seconds=int(args.timeout_seconds),
    )
    no_token_result = run_probe(
        sandbox_container=sandbox_container,
        endpoint=endpoint,
        name="bridge_post_no_token",
        method="POST",
        timeout_seconds=int(args.timeout_seconds),
        payload={"tool_name": "__bridge_smoke_unknown_tool__", "arguments": {}},
    )
    unknown_tool_result = run_probe(
        sandbox_container=sandbox_container,
        endpoint=endpoint,
        name="bridge_post_unknown_tool",
        method="POST",
        timeout_seconds=int(args.timeout_seconds),
        payload={"tool_name": "__bridge_smoke_unknown_tool__", "arguments": {}},
        token=token,
    )
    target_tool_result = run_probe(
        sandbox_container=sandbox_container,
        endpoint=endpoint,
        name="bridge_post_target_tool",
        method="POST",
        timeout_seconds=int(args.timeout_seconds),
        payload={"tool_name": str(args.tool), "arguments": tool_args},
        token=token,
    )
    direct_scout_result: ProbeResult | None = None
    if (
        scout_service_url
        and str(args.tool).strip() == "fetch_web_content"
        and isinstance(tool_args.get("url"), str)
        and str(tool_args.get("url")).strip()
    ):
        direct_scout_result = run_local_scout_probe(
            scout_service_url=scout_service_url,
            target_url=str(tool_args.get("url")),
            timeout_seconds=int(args.timeout_seconds),
        )

    if not args.keep_token:
        delete_token_in_redis(
            redis_container=redis_container,
            redis_password=redis_password,
            key=redis_key,
        )

    findings = analyze(
        get_result=get_result,
        no_token_result=no_token_result,
        unknown_tool_result=unknown_tool_result,
        target_tool_result=target_tool_result,
        direct_scout_result=direct_scout_result,
    )

    print("=== Bridge Smoke Summary ===")
    print(f"endpoint: {endpoint}")
    print(f"sandbox_container: {sandbox_container}")
    print(f"redis_container: {redis_container}")
    print(f"token_prefix: {token[:10]}...")
    print("")

    rows = [get_result, no_token_result, unknown_tool_result, target_tool_result]
    if direct_scout_result:
        rows.append(direct_scout_result)
    for row in rows:
        print(
            f"[{row.name}] http={row.http_code} "
            f"curl_exit={row.curl_exit_code} total={format_seconds(row.total_seconds)}"
        )
        if row.stderr:
            print(f"stderr: {row.stderr}")
        preview = row.body[:600] if row.body else ""
        if preview:
            print(f"body: {preview}")
        print("")

    print("=== Analysis ===")
    for idx, item in enumerate(findings, start=1):
        print(f"{idx}. {item}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"[bridge-smoke] failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
