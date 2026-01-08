import { AdaptiveSidebar } from "@/components/sidebars/adaptive-sidebar";
import { SidebarProvider } from "@/components/ui/sidebar";
import { TopNav } from "@/components/layout/top-nav";
import { BodyScrollLock } from "@/components/layout/body-scroll-lock";

export default function SystemLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <SidebarProvider>
            <div className="flex h-screen bg-background overflow-hidden w-full">
                <BodyScrollLock />
                <AdaptiveSidebar />
                <div className="flex-1 flex flex-col overflow-hidden">
                    <TopNav />
                    <main className="flex-1 overflow-y-auto no-scrollbar p-6">
                        {children}
                    </main>
                </div>
            </div>
        </SidebarProvider>
    );
}
