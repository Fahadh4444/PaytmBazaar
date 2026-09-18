"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import SceneDialog from "@/components/bazaar/SceneDialog";
import type { Shop } from "@/data/shops";
import type { MerchantInsightSnapshot } from "@/lib/merchant-insights/types";

import styles from "./bazaar-screen.module.css";

type MerchantDialogProps = {
  shop: Shop | null;
  bazaarId: string;
  bazaarName: string;
  open: boolean;
  onClose: () => void;
};

type ChatMessage = { role: "user" | "assistant"; content: string };

const rupees = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

export default function MerchantDialog({
  shop,
  bazaarId,
  bazaarName,
  open,
  onClose,
}: MerchantDialogProps) {
  const [insight, setInsight] = useState<MerchantInsightSnapshot | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(true);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const conversationRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !shop) return;
    const controller = new AbortController();

    const query = new URLSearchParams({ bazaarId, merchantName: shop.name });
    fetch(`/api/merchant-insights?${query}`, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Analysis could not be loaded.");
        setInsight(body as MerchantInsightSnapshot);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setAnalysisError(error instanceof Error ? error.message : "Analysis could not be loaded.");
      })
      .finally(() => setAnalysisLoading(false));

    return () => controller.abort();
  }, [bazaarId, open, shop]);

  useEffect(() => {
    conversationRef.current?.scrollTo({
      top: conversationRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, chatLoading]);

  const sendMessage = async (event: FormEvent) => {
    event.preventDefault();
    const question = draft.trim();
    if (!shop || !insight || !question || chatLoading) return;

    const nextMessages: ChatMessage[] = [...messages, { role: "user", content: question }];
    setMessages(nextMessages);
    setDraft("");
    setChatError(null);
    setChatLoading(true);

    try {
      const response = await fetch("/api/merchant-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bazaarId, merchantName: shop.name, messages: nextMessages }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "The assistant could not respond.");
      setMessages((current) => [...current, { role: "assistant", content: body.message }]);
    } catch (error) {
      setChatError(error instanceof Error ? error.message : "The assistant could not respond.");
    } finally {
      setChatLoading(false);
    }
  };

  const change = insight?.sevenDayChangePercent;

  return (
    <SceneDialog
      open={open}
      onClose={onClose}
      eyebrow="Merchant intelligence"
      title={shop ? shop.name : "Merchant"}
      workspace
    >
      <p className={styles.dialogLede}>{bazaarName}</p>

      <div className={styles.merchantWorkspace}>
        <section className={styles.analysisPanel} aria-labelledby="analysis-heading">
          <div className={styles.sectionHeadingRow}>
            <div>
              <p className={styles.sectionKicker}>Business pulse</p>
              <h3 id="analysis-heading" className={styles.workspaceHeading}>Analysis</h3>
            </div>
            {insight?.periodEnd && (
              <span className={styles.dataStamp}>
                Through {new Date(insight.periodEnd).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
              </span>
            )}
          </div>

          {analysisLoading && <div className={styles.analysisState}>Reading transaction signals…</div>}
          {analysisError && <div className={styles.analysisState}>{analysisError}</div>}

          {insight && (
            <>
              <div className={styles.metricGrid}>
                <article className={styles.metricHero}>
                  <span>Gross sales</span>
                  <strong>{rupees.format(insight.grossSalesInr)}</strong>
                  <small>{insight.successfulTransactions.toLocaleString("en-IN")} successful payments</small>
                </article>
                <article className={styles.metricCard}>
                  <span>Average order</span>
                  <strong>{rupees.format(insight.averageOrderValueInr)}</strong>
                </article>
                <article className={styles.metricCard}>
                  <span>Last 7 days</span>
                  <strong>{rupees.format(insight.sevenDaySalesInr)}</strong>
                  <small className={change == null ? undefined : change >= 0 ? styles.positive : styles.negative}>
                    {change == null ? "No prior comparison" : `${change >= 0 ? "+" : ""}${change.toFixed(1)}% vs prior 7 days`}
                  </small>
                </article>
              </div>

              <div className={styles.signalList}>
                <div><span>Leading payment mode</span><strong>{insight.leadingPaymentMode ?? "—"}</strong></div>
                <div><span>Pending payments</span><strong>{insight.pendingTransactions}</strong></div>
                <div><span>Failed payments</span><strong>{insight.failedTransactions}</strong></div>
                <div><span>Refunded value</span><strong>{rupees.format(insight.refundsInr)}</strong></div>
              </div>
            </>
          )}
        </section>

        <section className={styles.chatPanel} aria-labelledby="merchant-view-heading">
          <div className={styles.chatHeading}>
            <div>
              <p className={styles.sectionKicker}>AI-guided view</p>
              <h3 id="merchant-view-heading" className={styles.workspaceHeading}>What Merchant Sees</h3>
            </div>
            <span className={styles.liveBadge}><i /> DeepSeek</span>
          </div>

          <div className={styles.conversation} ref={conversationRef} aria-live="polite">
            {messages.length === 0 && (
              <div className={styles.chatWelcome}>
                <span className={styles.spark}>✦</span>
                <strong>Ask about your business</strong>
                <p>I can explain the transaction patterns shown in your analysis.</p>
                <div className={styles.suggestions}>
                  {["How are my sales trending?", "What should I focus on?", "Explain my payment failures"].map((suggestion) => (
                    <button key={suggestion} type="button" onClick={() => setDraft(suggestion)} disabled={!insight}>
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((message, index) => (
              <div key={`${message.role}-${index}`} className={message.role === "user" ? styles.userMessage : styles.assistantMessage}>
                {message.content}
              </div>
            ))}
            {chatLoading && <div className={styles.assistantMessage}>Thinking through your business signals…</div>}
          </div>

          {chatError && <p className={styles.chatError}>{chatError}</p>}

          <form className={styles.chatComposer} onSubmit={sendMessage}>
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              maxLength={800}
              placeholder={insight ? "Ask about your business insights…" : "Waiting for merchant data…"}
              aria-label="Ask about your business insights"
              disabled={!insight || chatLoading}
            />
            <button type="submit" disabled={!insight || !draft.trim() || chatLoading} aria-label="Send message">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="m5 12 14-7-4 14-3-6-7-1Z" />
              </svg>
            </button>
          </form>
          <p className={styles.chatFootnote}>Answers use computed transaction data—not invented figures.</p>
        </section>
      </div>
    </SceneDialog>
  );
}
