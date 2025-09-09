// Behavior3JS custom nodes for goal-directed NPCs (chaos).
// UtilitySelector picks highest utility child Tactic.
// Tactic is a decorator carrying scoring metadata.

const SCOPE = "game";

// Helpers
function bbGet(bb, k, d, scope=SCOPE){ const v = bb.get(k, scope); return v===undefined? d : v; }
function bbSet(bb, k, v, scope=SCOPE){ bb.set(k, v, scope); }
function now(){ return Date.now(); }
function evalExpr(expr, ctx){ return Function(...Object.keys(ctx), `return (${expr});`)(...Object.values(ctx)); }

class Tactic extends b3.Decorator {
  constructor(){ super(); this.name = "Tactic"; }
  tick(t){ return this.child ? this.child._execute(t) : b3.FAILURE; }
}

class UtilitySelector extends b3.Composite {
  constructor(){ super(); this.name = "UtilitySelector"; }
  tick(tick){
    const s = tick.target.story;
    const bb = tick.blackboard;

    // Ink-like variable reads (numeric or string coerced)
    const v = (k, d=0) => {
      const val = s?.variablesState?.[k];
      return typeof val === "number" ? val : (typeof val === "string" ? Number(val)||d : d);
    };

    const ctxBase = {
      mood: v("mood",0), heat: v("heat",0), threat: v("threat",0),
      trust: v("trust",0), crowd: v("crowd",1), guard: v("guard_near",0), drunk: v("drunk",0)
    };

    const stats = bbGet(bb, "chaos_stats", {}, SCOPE);

    let best = -Infinity, chosen = null, chosenChild = null;
    for (const child of this.children){
      const name = child.properties?.name || "tactic";
      const cdMs = Number(child.properties?.cooldownMs || 0);
      const st = stats[name] || { s:0, f:0, lastMs:0 };
      const tries = st.s + st.f;
      const sr = tries ? st.s / tries : 0.5;
      const lastSec = st.lastMs ? (now()-st.lastMs)/1000 : 1e9;

      const ctx = { ...ctxBase, sr, tries, lastSec };
      const expr = String(child.properties?.scoreExpr || "0");
      let u = Number(evalExpr(expr, ctx));

      if (cdMs && st.lastMs && now()-st.lastMs < cdMs) u = -1e6;
      if (u > best){ best = u; chosen = name; chosenChild = child; }
    }

    if (!chosenChild) return b3.FAILURE;

    // Soft inhibition stamp
    const st2 = { ...bbGet(bb, "chaos_stats", {}, SCOPE) };
    st2[chosen] = st2[chosen] || { s:0, f:0, lastMs:0 };
    st2[chosen].lastMs = now();
    bbSet(bb, "chaos_stats", st2, SCOPE);
    bbSet(bb, "last_tactic", chosen, SCOPE);

    return chosenChild._execute(tick);
  }
}

class RecordOutcome extends b3.Action {
  // properties: { tacticKeyVar: "last_tactic", okVar: "last_outcome_ok" }
  tick(t){
    const s = t.target.story, bb = t.blackboard;
    if (!s?.variablesState) return b3.FAILURE;
    const tacticKey = this.properties?.tacticKeyVar || "last_tactic";
    const okVar     = this.properties?.okVar || "last_outcome_ok";
    const name = bbGet(bb, tacticKey, null, SCOPE);
    const ok = !!s.variablesState[okVar];

    if (!name) return b3.FAILURE;
    const stats = bbGet(bb, "chaos_stats", {}, SCOPE);
    stats[name] = stats[name] || { s:0, f:0, lastMs: now() };
    if (ok) stats[name].s++; else stats[name].f++;
    bbSet(bb, "chaos_stats", stats, SCOPE);
    return b3.SUCCESS;
  }
}

export { Tactic, UtilitySelector, RecordOutcome, SCOPE, bbGet, bbSet };