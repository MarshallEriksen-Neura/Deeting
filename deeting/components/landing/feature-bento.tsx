"use client"

import { motion } from "framer-motion"
import { ShieldCheck, Zap, Terminal, Lock, Database, Command } from "lucide-react"

const features = [
  {
    title: "打破次元壁",
    titleEn: "Localhost Access",
    desc: "Web 做不到的，它可以。直接连接本地 Ollama/LM Studio，无需内网穿透，零延迟体验。",
    icon: Terminal,
    color: "from-blue-500/20 to-cyan-500/20",
    border: "border-blue-500/20",
    iconColor: "text-blue-400"
  },
  {
    title: "数据隐形衣",
    titleEn: "Privacy Vault",
    desc: "聊天记录存入本地 SQLite，API Key 存入系统钥匙串。服务器？它什么都不知道。",
    icon: ShieldCheck,
    color: "from-emerald-500/20 to-teal-500/20",
    border: "border-emerald-500/20",
    iconColor: "text-emerald-400"
  },
  {
    title: "系统级助手",
    titleEn: "OS Integration",
    desc: "全局快捷键 (⌘+K) 唤起，系统托盘驻留。AI 不再是网页，而是你的系统外挂。",
    icon: Command,
    color: "from-purple-500/20 to-pink-500/20",
    border: "border-purple-500/20",
    iconColor: "text-purple-400"
  }
]

export function FeatureBento() {
  return (
    <div className="container mx-auto px-6 py-24">
      <div className="text-center mb-16 space-y-4">
         <h2 className="text-3xl md:text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-foreground to-foreground/60">
            Why Deeting?
         </h2>
         <p className="text-muted-foreground max-w-2xl mx-auto">
            Build for developers who refuse to compromise on privacy or performance.
         </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-6xl mx-auto">
        {features.map((f, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: i * 0.1 }}
            className={`relative group overflow-hidden rounded-3xl border ${f.border} bg-card/60 backdrop-blur-xl p-8 hover:bg-accent/50 transition-all duration-500 hover:-translate-y-1`}
          >
            {/* Hover Gradient */}
            <div className={`absolute inset-0 bg-gradient-to-br ${f.color} opacity-0 group-hover:opacity-100 transition-opacity duration-500 blur-2xl`} />
            
            <div className="relative z-10 flex flex-col h-full items-start">
              <div className={`p-3 rounded-2xl bg-accent/50 border border-border mb-6 ${f.iconColor} group-hover:scale-110 transition-transform duration-300`}>
                 <f.icon className="size-6" />
              </div>
              
              <h3 className="text-xl font-bold text-foreground mb-1">{f.title}</h3>
              <p className="text-xs font-mono text-muted-foreground mb-4 uppercase tracking-wider">{f.titleEn}</p>

              <p className="text-muted-foreground leading-relaxed group-hover:text-foreground transition-colors">
                {f.desc}
              </p>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  )
}