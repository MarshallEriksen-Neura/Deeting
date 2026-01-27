"use client";

import { useState, useCallback } from "react";
import { Upload, Image as ImageIcon, Sparkles } from "lucide-react";
import { useI18n } from "@/hooks/use-i18n";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { GlassCard } from "@/components/ui/glass-card";

export function InputSection() {
  const t = useI18n("video");
  const [prompt, setPrompt] = useState("");
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);

  const handleImageUpload = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      setUploadedImage(url);
    }
  }, []);

  return (
    <div className="space-y-4 lg:space-y-6">
      {/* Multi-modal Input Slot */}
      <div className="space-y-3">
        <label className="text-sm font-medium text-white/90">Reference Image</label>
        <div
          className="relative border-2 border-dashed border-white/20 rounded-2xl p-6 lg:p-8 text-center hover:border-cyan-400/50 transition-colors cursor-pointer group"
          onClick={() => document.getElementById('image-upload')?.click()}
        >
          {uploadedImage ? (
            <div className="relative">
              <img
                src={uploadedImage}
                alt="Reference"
                className="w-full h-24 lg:h-32 object-cover rounded-xl"
              />
              <div className="absolute inset-0 bg-black/20 rounded-xl flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <Upload className="w-6 h-6 text-white" />
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="w-10 lg:w-12 h-10 lg:h-12 mx-auto bg-cyan-500/20 rounded-full flex items-center justify-center">
                <ImageIcon className="w-5 lg:w-6 h-5 lg:h-6 text-cyan-400" />
              </div>
              <div className="text-xs lg:text-sm text-white/70">
                Drag & drop or click to upload reference image
              </div>
            </div>
          )}
          <input
            id="image-upload"
            type="file"
            accept="image/*"
            onChange={handleImageUpload}
            className="hidden"
          />
        </div>
      </div>

      {/* Prompt Laboratory */}
      <div className="space-y-3">
        <label className="text-sm font-medium text-white/90 flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-cyan-400" />
          Prompt
        </label>
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe the video you want to create... (supports Markdown)"
          className="min-h-[100px] lg:min-h-[120px] bg-white/5 border-white/10 text-white placeholder:text-white/50 focus:border-cyan-400/50 resize-none text-sm"
        />
        <div className="text-xs text-white/60">
          Use descriptive language, emotions, and specific details for better results
        </div>
      </div>
    </div>
  );
}