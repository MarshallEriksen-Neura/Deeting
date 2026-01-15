
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

export const import { 
  // Generic & AI
  Webhook, Cpu, BrainCircuit, Bot, Sparkles, Zap, Globe, Code2,
  Search, Languages, Fingerprint, Share2, Lightbulb, Brain,
  
  // Hardware & Infrastructure
  Terminal, Server, HardDrive, Laptop, CloudOff, Database, Router, Cloud, Layers,

  // Assistant & Persona
  User, UserCog, Smile, GraduationCap, Headset, Stethoscope, Briefcase, 
  Palette, Music, Video, Image, Mic, Headphones, Microscope, Scale, Glasses,
  
  // Fun & Metaphor
  Rocket, Gamepad2, Ghost, Sword, Crown, Candy, Coffee, Beer, Pizza, Star, Heart,
  
  LucideIcon
} from "lucide-react";

export interface ProviderIconOption {
  id: string; // 将被存入 provider_instance.icon 或 assistant.avatar
  label: string;
  icon: LucideIcon; 
  category: 'generic' | 'hardware' | 'fun' | 'assistant';
}

export const PROVIDER_ICON_OPTIONS: ProviderIconOption[] = [
  // Generic / Abstract
  { id: 'lucide:webhook', label: 'Webhook', icon: Webhook, category: 'generic' },
  { id: 'lucide:cpu', label: 'Processor', icon: Cpu, category: 'generic' },
  { id: 'lucide:brain-circuit', label: 'AI Circuit', icon: BrainCircuit, category: 'generic' },
  { id: 'lucide:zap', label: 'Fast', icon: Zap, category: 'generic' },
  { id: 'lucide:globe', label: 'Global', icon: Globe, category: 'generic' },
  { id: 'lucide:code-2', label: 'Code', icon: Code2, category: 'generic' },
  { id: 'lucide:search', label: 'Search', icon: Search, category: 'generic' },
  { id: 'lucide:languages', label: 'Translate', icon: Languages, category: 'generic' },
  { id: 'lucide:fingerprint', label: 'Identity', icon: Fingerprint, category: 'generic' },
  { id: 'lucide:share-2', label: 'Connect', icon: Share2, category: 'generic' },

  // Assistant / Persona (新分类，适合助手头像)
  { id: 'lucide:bot', label: 'Robot', icon: Bot, category: 'assistant' },
  { id: 'lucide:user', label: 'User', icon: User, category: 'assistant' },
  { id: 'lucide:user-cog', label: 'Expert', icon: UserCog, category: 'assistant' },
  { id: 'lucide:smile', label: 'Friendly', icon: Smile, category: 'assistant' },
  { id: 'lucide:sparkles', label: 'Magic', icon: Sparkles, category: 'assistant' },
  { id: 'lucide:brain', label: 'Brain', icon: Brain, category: 'assistant' },
  { id: 'lucide:lightbulb', label: 'Idea', icon: Lightbulb, category: 'assistant' },
  { id: 'lucide:graduation-cap', label: 'Tutor', icon: GraduationCap, category: 'assistant' },
  { id: 'lucide:headset', label: 'Support', icon: Headset, category: 'assistant' },
  { id: 'lucide:stethoscope', label: 'Health', icon: Stethoscope, category: 'assistant' },
  { id: 'lucide:briefcase', label: 'Office', icon: Briefcase, category: 'assistant' },
  { id: 'lucide:palette', label: 'Artist', icon: Palette, category: 'assistant' },
  { id: 'lucide:music', label: 'Musician', icon: Music, category: 'assistant' },
  { id: 'lucide:video', label: 'Director', icon: Video, category: 'assistant' },
  { id: 'lucide:image', label: 'Gallery', icon: Image, category: 'assistant' },
  { id: 'lucide:mic', label: 'Speaker', icon: Mic, category: 'assistant' },
  { id: 'lucide:headphones', label: 'Listener', icon: Headphones, category: 'assistant' },
  { id: 'lucide:microscope', label: 'Scientist', icon: Microscope, category: 'assistant' },
  { id: 'lucide:scale', label: 'Legal', icon: Scale, category: 'assistant' },
  { id: 'lucide:glasses', label: 'Smart', icon: Glasses, category: 'assistant' },

  // Local / Self-hosted
  { id: 'lucide:terminal', label: 'Terminal', icon: Terminal, category: 'hardware' },
  { id: 'lucide:server', label: 'Server', icon: Server, category: 'hardware' },
  { id: 'lucide:hard-drive', label: 'Storage', icon: HardDrive, category: 'hardware' },
  { id: 'lucide:laptop', label: 'Device', icon: Laptop, category: 'hardware' },
  { id: 'lucide:cloud-off', label: 'Offline', icon: CloudOff, category: 'hardware' },
  { id: 'lucide:database', label: 'Database', icon: Database, category: 'hardware' },
  { id: 'lucide:router', label: 'Network', icon: Router, category: 'hardware' },
  { id: 'lucide:cloud', label: 'Cloud', icon: Cloud, category: 'hardware' },
  { id: 'lucide:layers', label: 'Stack', icon: Layers, category: 'hardware' },

  // Fun / Metaphor
  { id: 'lucide:rocket', label: 'Rocket', icon: Rocket, category: 'fun' },
  { id: 'lucide:gamepad-2', label: 'Game', icon: Gamepad2, category: 'fun' },
  { id: 'lucide:ghost', label: 'Ghost', icon: Ghost, category: 'fun' },
  { id: 'lucide:sword', label: 'Battle', icon: Sword, category: 'fun' },
  { id: 'lucide:crown', label: 'Elite', icon: Crown, category: 'fun' },
  { id: 'lucide:candy', label: 'Sweet', icon: Candy, category: 'fun' },
  { id: 'lucide:coffee', label: 'Coffee', icon: Coffee, category: 'fun' },
  { id: 'lucide:beer', label: 'Social', icon: Beer, category: 'fun' },
  { id: 'lucide:pizza', label: 'Pizza', icon: Pizza, category: 'fun' },
  { id: 'lucide:star', label: 'Favorite', icon: Star, category: 'fun' },
  { id: 'lucide:heart', label: 'Love', icon: Heart, category: 'fun' },
];

export const getIconComponent = (iconId: string | null | undefined): LucideIcon | null => {
    if (!iconId) return null;
    if (iconId.startsWith("lucide:")) {
        const found = PROVIDER_ICON_OPTIONS.find(opt => opt.id === iconId);
        return found ? found.icon : Webhook; // Default fallback
    }
    return null;
};

export const getIconComponent = (iconId: string | null | undefined): LucideIcon | null => {
    if (!iconId) return null;
    if (iconId.startsWith("lucide:")) {
        const found = PROVIDER_ICON_OPTIONS.find(opt => opt.id === iconId);
        return found ? found.icon : Webhook; // Default fallback
    }
    return null;
}
