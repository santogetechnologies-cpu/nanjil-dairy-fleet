import { useState, useRef, useEffect } from "react";
import { PageHeader } from "@/components/AppLayout";
import { Card, Button } from "@/components/ui-kit";
import { Sparkles, Send, User, Bot } from "lucide-react";
import { motion } from "framer-motion";
import { supabase } from "@/lib/supabase";

interface Msg { role: "user" | "ai"; text: string; time: string }

async function getAIResponse(q: string): Promise<string> {
  const query = q.toLowerCase();

  try {
    if (/highest fuel|most fuel|fuel consum/i.test(query)) {
      const { data: v } = await supabase
        .from('v_vehicles')
        .select('number, fuel, route')
        .order('fuel', { ascending: false })
        .limit(1);

      if (v && v.length > 0) {
        return `Based on telemetry, vehicle ${v[0].number} on route "${v[0].route || 'Unassigned'}" currently has the highest fuel level of ${v[0].fuel}%.`;
      }
      return "Unable to retrieve fuel records from the database.";
    }

    if (/safety|driver score|risky driver/i.test(query)) {
      const { data: d } = await supabase
        .from('drivers')
        .select('name, score, rating')
        .order('score', { ascending: true })
        .limit(1);

      if (d && d.length > 0) {
        return `Driver ${d[0].name} has the lowest safety score of ${d[0].score}% (Rating: ${d[0].rating}). Suggest reviewing safety events and guidelines.`;
      }
      return "No driver safety records registered in the database.";
    }

    if (/route|delay/i.test(query)) {
      const { data: allR } = await supabase
        .from('collection_routes')
        .select('name, status');

      if (!allR || allR.length === 0) {
        return "No collection routes are currently configured in the database.";
      }

      const delayed = allR.filter(x => x.status === 'Delayed');
      if (delayed.length > 0) {
        return `Delayed collection routes: ${delayed.map(x => `"${x.name}"`).join(', ')}. Recommend checking with dispatchers.`;
      }
      return "All registered routes are currently on time or completed.";
    }

    if (/performance|summary|today/i.test(query)) {
      const { data: v } = await supabase.from('v_vehicles').select('status');
      const { data: a } = await supabase.from('alerts').select('id').eq('resolved', false);

      if (v) {
        const moving = v.filter(x => x.status === 'Moving').length;
        const idle = v.filter(x => x.status === 'Idle').length;
        const parked = v.filter(x => x.status === 'Parked').length;
        const offline = v.filter(x => x.status === 'Offline').length;
        const openAlerts = a ? a.length : 0;

        return `Today's Summary: ${moving} moving, ${idle} idle, ${parked} parked, ${offline} offline. There are ${openAlerts} unresolved alerts in the database.`;
      }
      return "No active vehicle summaries could be compiled.";
    }

    return "I am your fleet assistant. Try asking about 'fuel consumption', 'driver safety', 'route delays' or a 'fleet summary' to query live database metrics.";
  } catch (err: any) {
    return `An error occurred while compiling AI response: ${err?.message || err}`;
  }
}

function Page() {
  const [msgs, setMsgs] = useState<Msg[]>([
    { role: "ai", text: "Hello, I'm Nanjil AI. I can analyse your fleet across fuel, driver safety, routes and vehicle performance. What would you like to know?", time: "now" },
  ]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs, thinking]);

  async function send(text: string) {
    if (!text.trim()) return;
    const time = new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
    setMsgs((m) => [...m, { role: "user", text, time }]);
    setInput("");
    setThinking(true);
    
    const reply = await getAIResponse(text);
    
    setMsgs((m) => [...m, { role: "ai", text: reply, time }]);
    setThinking(false);
  }

  const suggestions = [
    "Which vehicle consumed highest fuel this month?",
    "Show me drivers who need safety improvement",
    "Are there any delayed collection routes?",
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
                className="px-3 py-1.5 text-xs rounded-full border border-border bg-card hover:bg-muted transition-colors">
                {s}
              </button>
            ))}
          </div>
        )}

        <form onSubmit={(e) => { e.preventDefault(); send(input); }}
          className="p-3 border-t border-border flex gap-2">
          <input value={input} onChange={(e) => setInput(e.target.value)}
            placeholder="Type your question..."
            className="flex-1 px-3 border border-border rounded-md bg-card text-sm outline-none focus:ring-2 focus:ring-ring" />
          <Button><Send className="h-4 w-4" /></Button>
        </form>
      </Card>
    </div>
  );
}

export default Page;
