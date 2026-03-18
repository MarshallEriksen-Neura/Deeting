"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { NeuralBackground } from "@/components/neural-background";
import { TitleBar } from "@/components/title-bar";
import { WelcomeStep } from "@/components/steps/welcome";
import { InstallingStep } from "@/components/steps/installing";
import { CompleteStep } from "@/components/steps/complete";

export type InstallStep = "welcome" | "installing" | "complete";

export interface InstallOptions {
  installPath: string;
  createShortcut: boolean;
  autoStart: boolean;
}

export default function InstallerPage() {
  const [step, setStep] = useState<InstallStep>("welcome");
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState("");
  const [options, setOptions] = useState<InstallOptions>({
    installPath: "",
    createShortcut: true,
    autoStart: false,
  });

  // 获取默认安装路径
  useEffect(() => {
    (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const path = await invoke<string>("get_default_install_path");
        setOptions((prev) => ({ ...prev, installPath: path }));
      } catch {
        // dev fallback
        setOptions((prev) => ({
          ...prev,
          installPath: "C:\\Users\\You\\AppData\\Local\\Deeting",
        }));
      }
    })();
  }, []);

  // 监听安装进度事件
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        unlisten = await listen<{
          stage: string;
          percent: number;
          message: string;
        }>("install-progress", (event) => {
          setProgress(event.payload.percent);
          setProgressMessage(event.payload.message);

          if (event.payload.stage === "done") {
            setTimeout(() => setStep("complete"), 600);
          }
        });
      } catch {
        // dev mode, no tauri events
      }
    })();

    return () => unlisten?.();
  }, []);

  const handleStartInstall = useCallback(async () => {
    setStep("installing");
    setProgress(0);

    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("start_install", {
        config: {
          install_path: options.installPath,
          create_shortcut: options.createShortcut,
          auto_start: options.autoStart,
        },
      });
    } catch {
      // Dev mode: simulate progress
      const stages = [
        { p: 10, msg: "正在准备安装环境..." },
        { p: 20, msg: "正在解压应用文件..." },
        { p: 35, msg: "正在安装核心框架..." },
        { p: 48, msg: "正在配置 AI Agent 引擎..." },
        { p: 60, msg: "正在部署 MCP 插件系统..." },
        { p: 72, msg: "正在安装会议分析模块..." },
        { p: 85, msg: "正在配置语音识别引擎..." },
        { p: 92, msg: "正在注册系统组件..." },
        { p: 97, msg: "正在创建快捷方式..." },
        { p: 100, msg: "安装完成！" },
      ];

      for (const stage of stages) {
        await new Promise((r) => setTimeout(r, 700));
        setProgress(stage.p);
        setProgressMessage(stage.msg);
      }

      setTimeout(() => setStep("complete"), 600);
    }
  }, [options]);

  const handleLaunch = useCallback(async () => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("launch_app", { installPath: options.installPath });
      await invoke("quit_installer");
    } catch {
      // dev mode
    }
  }, [options.installPath]);

  const handleQuit = useCallback(async () => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("quit_installer");
    } catch {
      // dev mode
    }
  }, []);

  return (
    <div className="relative w-screen h-screen overflow-hidden rounded-2xl bg-[var(--bg-dark)]">
      {/* 神经网络粒子背景 */}
      <NeuralBackground />

      {/* 标题栏 */}
      <TitleBar onClose={handleQuit} />

      {/* 主内容区 */}
      <main className="relative z-10 flex flex-col items-center justify-center h-[calc(100%-36px)] px-12">
        {step === "welcome" && (
          <WelcomeStep
            options={options}
            onOptionsChange={setOptions}
            onInstall={handleStartInstall}
          />
        )}

        {step === "installing" && (
          <InstallingStep progress={progress} message={progressMessage} />
        )}

        {step === "complete" && (
          <CompleteStep
            options={options}
            onOptionsChange={setOptions}
            onLaunch={handleLaunch}
            onClose={handleQuit}
          />
        )}
      </main>
    </div>
  );
}
