"use client";

import * as React from "react";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { PROVIDER_ICON_OPTIONS, getIconComponent, ProviderIconOption } from "@/lib/constants/provider-icons";

interface ProviderIconPickerProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

export function ProviderIconPicker({ value, onChange, className }: ProviderIconPickerProps) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");

  // Get current icon component
  const CurrentIcon = getIconComponent(value) || getIconComponent("lucide:webhook")!;

  // Filter options
  const filteredOptions = React.useMemo(() => {
    if (!search) return PROVIDER_ICON_OPTIONS;
    return PROVIDER_ICON_OPTIONS.filter(opt => 
      opt.label.toLowerCase().includes(search.toLowerCase()) || 
      opt.id.toLowerCase().includes(search.toLowerCase())
    );
  }, [search]);

  // Group options
  const groupedOptions = React.useMemo(() => {
    const groups: Record<string, ProviderIconOption[]> = {
      generic: [],
      hardware: [],
      fun: []
    };
    filteredOptions.forEach(opt => {
      if (groups[opt.category]) {
        groups[opt.category].push(opt);
      }
    });
    return groups;
  }, [filteredOptions]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("w-full justify-between", className)}
        >
          <span className="flex items-center gap-2">
            <CurrentIcon className="h-4 w-4 text-muted-foreground" />
            {PROVIDER_ICON_OPTIONS.find((framework) => framework.id === value)?.label || "Select icon..."}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[320px] p-0" align="start">
        <div className="flex items-center border-b px-3">
          <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
          <Input 
            placeholder="Search icon..." 
            className="flex h-10 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 border-none shadow-none focus-visible:ring-0 px-0"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <ScrollArea className="h-[300px]">
          <div className="p-2 space-y-4">
            {Object.entries(groupedOptions).map(([category, options]) => {
              if (options.length === 0) return null;
              return (
                <div key={category}>
                  <div className="mb-2 px-2 text-xs font-semibold text-muted-foreground capitalize">
                    {category === 'hardware' ? 'Hardware / Local' : category}
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    {options.map((option) => (
                      <IconItem 
                        key={option.id} 
                        option={option} 
                        isSelected={value === option.id} 
                        onSelect={(currentValue) => {
                          onChange(currentValue === value ? "" : currentValue);
                          setOpen(false);
                        }}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
            {filteredOptions.length === 0 && (
              <div className="py-6 text-center text-sm text-muted-foreground">
                No icon found.
              </div>
            )}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

function IconItem({ option, isSelected, onSelect }: { 
    option: ProviderIconOption, 
    isSelected: boolean, 
    onSelect: (val: string) => void 
}) {
    const Icon = option.icon;
    return (
        <div 
            className={cn(
                "flex flex-col items-center justify-center p-2 rounded-md cursor-pointer hover:bg-accent hover:text-accent-foreground transition-colors border border-transparent",
                isSelected && "bg-accent text-accent-foreground border-primary"
            )}
            onClick={() => onSelect(option.id)}
            title={option.label}
        >
            <Icon className="h-6 w-6 mb-1" />
            <span className="text-[10px] truncate w-full text-center">{option.label}</span>
        </div>
    )
}