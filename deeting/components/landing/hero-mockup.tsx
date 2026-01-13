"use client"

import { motion } from "framer-motion"
import { Download, LayoutGrid, ShieldCheck, Zap, Cpu, Terminal, Database, ArrowRight } from "lucide-react"
import Link from "next/link"
import { GlassButton } from "@/components/ui/glass-button"

export function LandingHero() {
  return (
    <div className="relative min-h-[90vh] flex flex-col justify-center overflow-hidden">
      
      {/* 1. 背景氛围光 (Ethereal Glow) */}
      <div className="absolute top-[-20%] left-[-10%] w-[600px] h-[600px] bg-blue-600/10 rounded-full blur-[120px] animate-pulse pointer-events-none" />
      <div className="absolute bottom-[10%] right-[-5%] w-[500px] h-[500px] bg-purple-600/10 rounded-full blur-[100px] pointer-events-none" />
      
      {/* Grid Pattern Overlay */}
      <div className="absolute inset-0 bg-[url('/grid.svg')] bg-center [mask-image:linear-gradient(180deg,white,rgba(255,255,255,0))]" style={{ opacity: 0.05 }} />

      <div className="container mx-auto px-6 relative z-10 pt-20">
        <div className="flex flex-col lg:flex-row items-center gap-16 lg:gap-24">
          
          {/* 2. 左侧文案区 */}
          <div className="lg:w-1/2 space-y-8 text-center lg:text-left relative">
            {/* 装饰性光点 */}
            <div className="absolute -left-20 top-0 w-40 h-40 bg-blue-500/20 blur-3xl rounded-full pointer-events-none" />

            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10 backdrop-blur-md text-xs font-medium text-blue-300 shadow-lg shadow-blue-500/10"
            >
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
              </span>
              v1.0 Release · DeepSeek-R1 Ready
            </motion.div>

            <motion.h1 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.1 }}
              className="text-5xl lg:text-7xl font-bold tracking-tight leading-[1.1]"
            >
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-indigo-400 to-purple-400">
                谛听 Deeting
              </span>
              <br />
              <span className="text-white drop-shadow-2xl">
                掌控万千模型
              </span>
            </motion.h1>

            <motion.p 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.2 }}
              className="text-lg text-gray-400 max-w-xl mx-auto lg:mx-0 leading-relaxed font-light"
            >
              Your Ultimate Local AI Command Center. <br className="hidden lg:block" />
              Connect Ollama, DeepSeek, and OpenAI in one elegant, privacy-first interface.
            </motion.p>

            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.3 }}
              className="flex flex-col sm:flex-row gap-4 justify-center lg:justify-start"
            >
              {/* 主 CTA：下载 */}
              <Link href="/download" className="relative group">
                <div className="absolute -inset-0.5 bg-gradient-to-r from-blue-500 to-purple-600 rounded-xl blur opacity-30 group-hover:opacity-75 transition duration-200"></div>
                <button className="relative w-full sm:w-auto px-8 py-4 bg-white text-black rounded-xl font-bold text-base hover:bg-gray-50 transition-all flex items-center justify-center gap-2 shadow-xl">
                  <Download className="w-5 h-5" />
                  Download App
                </button>
              </Link>

              {/* 副 CTA：Web 预览 */}
              <Link href="/market">
                <button className="w-full sm:w-auto px-8 py-4 rounded-xl font-medium text-white border border-white/10 hover:bg-white/5 hover:border-white/20 transition-all flex items-center justify-center gap-2 backdrop-blur-sm">
                  <LayoutGrid className="w-5 h-5" />
                  Live Demo
                </button>
              </Link>
            </motion.div>

            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.5, delay: 0.5 }}
              className="pt-8 flex flex-wrap items-center justify-center lg:justify-start gap-6 text-gray-500 text-xs font-medium uppercase tracking-wider"
            >
              <div className="flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-emerald-500" /> Local Privacy</div>
              <div className="flex items-center gap-2"><Cpu className="w-4 h-4 text-blue-500" /> Apple Silicon</div>
              <div className="flex items-center gap-2"><Zap className="w-4 h-4 text-amber-500" /> 0ms Latency</div>
            </motion.div>
          </div>

          {/* 3. 右侧视觉区：超酷的 Glassmorphism 截图 */}
          <motion.div 
            initial={{ opacity: 0, scale: 0.9, rotateY: -20 }}
            animate={{ opacity: 1, scale: 1, rotateY: 0 }}
            transition={{ duration: 0.8, ease: "easeOut" }}
            className="lg:w-1/2 relative perspective-1000"
          >
            {/* 装饰性光环 */}
            <div className="absolute inset-0 bg-gradient-to-tr from-blue-500/10 to-purple-500/10 rounded-[2rem] blur-3xl transform rotate-6 scale-105 animate-pulse-slow" />
            
            {/* 模拟 App 窗口 */}
            <div className="relative bg-[#0A0A0F]/80 backdrop-blur-xl border border-white/10 rounded-[1.5rem] p-3 shadow-2xl transform rotate-[-2deg] hover:rotate-0 transition-all duration-500 ease-out group ring-1 ring-white/5">
              
              {/* 窗口内边框 */}
              <div className="absolute inset-0 rounded-[1.5rem] ring-1 ring-inset ring-white/10 pointer-events-none" />

              {/* 窗口控制点 */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
                 <div className="flex gap-2">
                    <div className="w-3 h-3 rounded-full bg-red-500/80 shadow-inner" />
                    <div className="w-3 h-3 rounded-full bg-yellow-500/80 shadow-inner" />
                    <div className="w-3 h-3 rounded-full bg-green-500/80 shadow-inner" />
                 </div>
                 <div className="text-[10px] text-gray-600 font-mono flex items-center gap-1">
                    <Terminal className="size-3" /> local-gateway
                 </div>
                 <div className="w-10" />
              </div>

              {/* 内部 UI 骨架 */}
              <div className="bg-[#05050A] rounded-b-xl h-[420px] flex flex-col relative overflow-hidden">
                
                {/* 侧边栏模拟 */}
                <div className="absolute left-0 top-0 bottom-0 w-16 border-r border-white/5 flex flex-col items-center py-4 gap-4">
                   <div className="w-10 h-10 rounded-xl bg-blue-600/20 border border-blue-600/30 flex items-center justify-center text-blue-500"><Terminal className="size-5" /></div>
                   <div className="w-10 h-10 rounded-xl hover:bg-white/5 flex items-center justify-center text-gray-600"><Database className="size-5" /></div>
                </div>

                {/* 聊天区域 */}
                <div className="ml-16 flex-1 p-6 flex flex-col justify-between h-full relative">
                  
                  {/* 背景网格 */}
                  <div className="absolute inset-0 bg-[url('/grid.svg')] opacity-[0.03]" />

                  <div className="space-y-6 relative z-10">
                    {/* Assistant Message */}
                    <div className="flex gap-4">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-xs font-bold shadow-lg shadow-blue-500/20">
                        AI
                      </div>
                      <div className="flex-1 space-y-2">
                         <div className="bg-white/5 border border-white/10 p-4 rounded-2xl rounded-tl-none text-sm text-gray-300 leading-relaxed backdrop-blur-md shadow-sm">
                           <span className="text-emerald-400 font-mono text-xs block mb-2">[System] Connected to localhost:11434</span>
                           DeepSeek-R1 is ready. I have loaded your local knowledge base "Project Titan". How can I help you analyze the secure logs today?
                         </div>
                         <div className="flex gap-2">
                           <span className="text-[10px] bg-green-500/10 text-green-400 border border-green-500/20 px-2 py-0.5 rounded flex items-center gap-1">
                              <Zap className="size-3" /> Lat: 2ms
                           </span>
                           <span className="text-[10px] bg-blue-500/10 text-blue-400 border border-blue-500/20 px-2 py-0.5 rounded flex items-center gap-1">
                              <ShieldCheck className="size-3" /> Offline
                           </span>
                         </div>
                      </div>
                    </div>
                  </div>

                  {/* Input Mock */}
                  <div className="relative z-10">
                    <div className="absolute inset-0 bg-gradient-to-t from-[#05050A] via-[#05050A] to-transparent -top-10 -z-10" />
                    <div className="h-12 bg-white/5 rounded-xl border border-white/10 flex items-center px-4 text-gray-500 text-sm shadow-lg ring-1 ring-white/5">
                      <span className="animate-pulse mr-1">|</span> Summarize the latest error logs...
                    </div>
                  </div>
                </div>
              </div>
              
              {/* 悬浮标牌：强调本地能力 */}
              <div className="absolute -right-8 top-1/3 bg-black/80 backdrop-blur-xl border border-green-500/30 p-3 rounded-xl shadow-2xl animate-bounce-slow z-20">
                <div className="flex items-center gap-3">
                  <div className="relative">
                     <div className="w-2 h-2 bg-green-500 rounded-full animate-ping absolute inset-0" />
                     <div className="w-2 h-2 bg-green-500 rounded-full relative" />
                  </div>
                  <div className="text-xs">
                    <div className="text-white font-bold tracking-wide">GPU Active</div>
                    <div className="text-gray-400 text-[10px]">RTX 4090 @ 80%</div>
                  </div>
                </div>
              </div>

            </div>
          </motion.div>
        </div>
      </div>
    </div>
  )
}