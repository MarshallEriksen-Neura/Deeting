
import { 
  Webhook, Cpu, BrainCircuit, Bot, Sparkles, Zap, Globe, Code2,
  Terminal, Server, HardDrive, Laptop, CloudOff,
  Rocket, Gamepad2, Ghost, Sword, 
  LucideIcon
} from "lucide-react";

export interface ProviderIconOption {
  id: string; // 将被存入 provider_instance.icon
  label: string;
  icon: LucideIcon; 
  category: 'generic' | 'hardware' | 'fun';
}

export const PROVIDER_ICON_OPTIONS: ProviderIconOption[] = [
  // Generic / Abstract (适合通用 HTTP 接口)
  { id: 'lucide:webhook', label: 'Webhook', icon: Webhook, category: 'generic' },
  { id: 'lucide:cpu', label: 'Processor', icon: Cpu, category: 'generic' },
  { id: 'lucide:brain-circuit', label: 'AI Brain', icon: BrainCircuit, category: 'generic' },
  { id: 'lucide:bot', label: 'Bot', icon: Bot, category: 'generic' },
  { id: 'lucide:sparkles', label: 'Sparkles', icon: Sparkles, category: 'generic' },
  { id: 'lucide:zap', label: 'Fast', icon: Zap, category: 'generic' },
  { id: 'lucide:globe', label: 'Global', icon: Globe, category: 'generic' },
  { id: 'lucide:code-2', label: 'Code', icon: Code2, category: 'generic' },

  // Local / Self-hosted (适合 Ollama / vLLM)
  { id: 'lucide:terminal', label: 'Terminal', icon: Terminal, category: 'hardware' },
  { id: 'lucide:server', label: 'Server', icon: Server, category: 'hardware' },
  { id: 'lucide:hard-drive', label: 'Local Disk', icon: HardDrive, category: 'hardware' },
  { id: 'lucide:laptop', label: 'Localhost', icon: Laptop, category: 'hardware' },
  { id: 'lucide:cloud-off', label: 'Offline', icon: CloudOff, category: 'hardware' },

  // Fun / Metaphor
  { id: 'lucide:rocket', label: 'Rocket', icon: Rocket, category: 'fun' },
  { id: 'lucide:gamepad-2', label: 'Game', icon: Gamepad2, category: 'fun' },
  { id: 'lucide:ghost', label: 'Ghost', icon: Ghost, category: 'fun' },
  { id: 'lucide:sword', label: 'Battle', icon: Sword, category: 'fun' },
];

export const getIconComponent = (iconId: string | null | undefined): LucideIcon | null => {
    if (!iconId) return null;
    if (iconId.startsWith("lucide:")) {
        const found = PROVIDER_ICON_OPTIONS.find(opt => opt.id === iconId);
        return found ? found.icon : Webhook; // Default fallback
    }
    return null;
}
