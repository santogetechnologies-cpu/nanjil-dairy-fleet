
import { useState, useRef, useEffect } from "react";
import { PageHeader } from "@/components/AppLayout";
import { Card, Button } from "@/components/ui-kit";
import { Sparkles, Send, User, Bot } from "lucide-react";
import { motion } from "framer-motion";

interface Msg { role: "user" | "ai"; text: string; time: string }

const RESPONSES: { match: RegExp; reply: string }[] = [
  { match: /highest fuel|most fuel|fuel consum/i,
    reply: "Vehicle TN-05-AC-1037 consumed 18% more fuel this month compared to fleet average — most likely due to AC overuse and idling on the Marthandam–Parassala route. Estimated extra spend: ₹ 6,400." },
  { match: /safety|driver score|risky driver/i,
    reply: "Drivers Suresh Babu and Vijay Anand have safety scores below 78%. Top events: harsh braking (31 incidents) and overspeed (42 incidents). Recommend a refresher session and route review." },
  { match: /cold chain|temperature/i,
    reply: "All cold chain vehicles are within the 2°C – 6°C compliance window. Two minor breaches detected on TN-02-BD-1185 between 14:20 and 14:32 — sensor self-recovered. Compliance rate this week: 96%." },
  { match: /route|delay/i,
    reply: "Route Marthandam–Parassala Loop has shown 12-minute average delay over the last 5 days, mostly due to extended stop time at Centre #4. Suggest swapping with Aralvaimozhi vehicle." },
  { match: /performance|summary|today/i,
    reply: "Today: 28 vehicles moving, 7 idle, 5 parked. 3 fuel alerts and 2 temperature alerts open. Average safety score 86%. Cold-chain compliance 96%. Maintenance: 4 services due within 30 days." },
];

function answer(q: string) {
  const m = RESPONSES.find((r) => r.match.test(q));
  if (m) return m.reply;
  return "I analysed the latest fleet telemetry. Based on current data, no critical anomalies detected. Try asking about fuel consumption, driver safety, cold-chain compliance, route delays or a fleet summary.";
}

function Page() {
  const [msgs, setMsgs] = useState<Msg[]>([
    { role: "ai", text: "Hello, I'm Nanjil AI. I can analyse your fleet across fuel, driver safety, routes, cold chain and vehicle performance. What would you like to know?", time: "now" },
  ]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs, thinking]);

  function send(text: string) {
    if (!text.trim()) return;
    const time = new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
    setMsgs((m) => [...m, { role: "user", text, time }]);
    setInput("");
    setThinking(true);
    setTimeout(() => {
      setMsgs((m) => [...m, { role: "ai", text: answer(text), time }]);
      setThinking(false);
    }, 900);
  }

  const suggestions = [
    "Which vehicle consumed highest fuel this month?",
    "Show me drivers who need safety improvement",
    "Are all cold chain vehicles compliant?",
    "Summarise today's fleet performance",
  ];

  return (
    <div>
      <PageHeader title="Nanjil AI Vehicle Assistant" subtitle="Ask questions about your fleet in natural language" />

      <Card className="flex flex-col" >
        <div ref={scrollRef} className="p-4 space-y-3 h-[500px] overflow-y-auto">
          {msgs.map((m, i) => (
            <motion.div key={i} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
              className={`flex gap-2.5 ${m.role === "user" ? "justify-end" : ""}`}>
              {m.role === "ai" && (
                <div className="h-8 w-8 rounded-md bg-primary text-primary-foreground flex items-center justify-center shrink-0">
                  <Bot className="h-4 w-4" />
                </div>
              )}
              <div className={`max-w-xl rounded-lg px-3.5 py-2.5 text-sm ${m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                {m.text}
                <div className={`text-[10px] mt-1 opacity-70`}>{m.time}</div>
              </div>
              {m.role === "user" && (
                <div className="h-8 w-8 rounded-md bg-muted flex items-center justify-center shrink-0">
                  <User className="h-4 w-4" />
                </div>
              )}
            </motion.div>
          ))}
          {thinking && (
            <div className="flex gap-2.5">
              <div className="h-8 w-8 rounded-md bg-primary text-primary-foreground flex items-center justify-center"><Bot className="h-4 w-4" /></div>
              <div className="bg-muted rounded-lg px-3.5 py-2.5 text-sm flex gap-1">
                <span className="h-2 w-2 bg-muted-foreground rounded-full animate-bounce" />
                <span className="h-2 w-2 bg-muted-foreground rounded-full animate-bounce [animation-delay:0.15s]" />
                <span className="h-2 w-2 bg-muted-foreground rounded-full animate-bounce [animation-delay:0.3s]" />
              </div>
            </div>
          )}
        </div>

        {msgs.length <= 1 && (
          <div className="px-4 pb-2 flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <button key={s} onClick={() => send(s)}
                className="text-xs px-2.5 py-1.5 rounded-full border border-border hover:bg-muted">
                <Sparkles className="h-3 w-3 inline mr-1" />{s}
              </button>
            ))}
          </div>
        )}

        <form onSubmit={(e) => { e.preventDefault(); send(input); }}
          className="border-t border-border p-3 flex gap-2">
          <input value={input} onChange={(e) => setInput(e.target.value)}
            placeholder="Ask Nanjil AI…"
            className="flex-1 h-10 px-3 bg-muted rounded-md outline-none text-sm" />
          <Button type="submit" disabled={!input.trim() || thinking}>
            <Send className="h-4 w-4" /> Send
          </Button>
        </form>
      </Card>
    </div>
  );
}

export default Page;
