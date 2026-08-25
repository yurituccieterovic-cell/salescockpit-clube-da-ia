import { Sidebar } from "./sidebar";

export function MainLayout({ children, backdrop }: { children: React.ReactNode; backdrop?: React.ReactNode }) {
  return (
    <div className={`flex h-screen overflow-hidden ${backdrop ? "" : "bg-background"}`}>
      {backdrop}
      <Sidebar />
      <main className="flex-1 overflow-y-auto overflow-x-hidden p-6 md:p-8 lg:p-10">
        <div className="mx-auto max-w-6xl w-full">
          {children}
        </div>
      </main>
    </div>
  );
}
