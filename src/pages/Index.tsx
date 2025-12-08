import TelegramChatWithDB from "@/components/TelegramChatWithDB";

const Index = () => {
  return (
    <main className="relative min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-black">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-16 bg-gradient-to-r from-emerald-500/20 via-cyan-500/10 to-purple-500/10 blur-3xl" />
      <TelegramChatWithDB />
    </main>
  );
};

export default Index;
