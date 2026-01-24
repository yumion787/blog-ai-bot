import { useState, useEffect, useRef } from 'react';
import { MessageCircle, X, Send, Bot, Loader2, Sparkles, Trash2, ExternalLink, AlertTriangle } from 'lucide-react';

// --- 型定義 ---
interface WPPost {
  title: { rendered: string };
  excerpt: { rendered: string };
  link: string;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

// --- 設定 ---
const getApiKey = (): string => {
  try {
    // '@ts-expect-error: import.meta.env is only available in Vite environments'
    const env = import.meta?.env;
    return env?.VITE_GEMINI_API_KEY || "";
  } catch {
    return "";
  }
};

const API_KEY = getApiKey();
const MODEL_NAME = "gemini-2.5-flash-preview-09-2025";
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${API_KEY}`;
const STORAGE_KEY = 'yumion_ai_chat_history_v7'; 

const WP_API_BASE = "https://yumion3blog.com/wp-json/wp/v2/posts?per_page=20"; 
const THEME_COLOR = "#359ec4";

const SYSTEM_PROMPT_TEMPLATE = (knowledge: string) => `
あなたはブログ「フリログ」運営者「yumion」の分身AIメンターです。
以下の【最新のブログ記事データ】を元に、相談者の不安を解消してください。

【最新のブログ記事データ】
${knowledge}

【回答ルール】
1. キャラクター: 30代の穏やかで頼れる兄貴分。親しみやすく、柔らかい言葉遣いで答えてください。
2. 回答構成（厳守）:
   - 【結論】: 質問に対する答えを一言で書く。その後に必ず「空行（改行2つ）」を入れてください。
   - 【ポイント】: 箇条書きではなく「1.」「2.」「3.」といった番号付きリストで3点以内に絞って書く。その後に必ず「空行（改行2つ）」を入れてください。
   - 詳細: 「この記事に詳しく書いたよ！」という一言を添えて、最も関連性の高い記事のURLを1つだけ提示してください。
3. 表記制限: 回答は極めて簡潔に。Markdownの太字（**）は絶対に使わず、強調は「 」（カギカッコ）を使ってください。
4. URL制限: 提示するURLは、回答に最も適したものを必ず「1つだけ」に絞ってください。同じURLや複数のURLを絶対に出さないでください。
5. 立ち位置: 営業→エンジニア→フリーランス→会社員というあなたの実体験に基づいたアドバイスをしてください。
`;

const QUICK_QUESTIONS = [
  "未経験からエンジニアになれる？",
  "フリーランスの節税を教えて",
  "年収ってどうなった？",
  "質問するのが怖いです..."
];

const stripHtml = (html: string) => {
  return html.replace(/<[^>]*>?/gm, '').substring(0, 500); 
};

const LinkifiedText = ({ content, isUser }: { content: string, isUser: boolean }) => {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const urls = content.match(urlRegex) || [];
  const uniqueUrls = Array.from(new Set(urls)); 
  const textWithoutUrls = content.replace(urlRegex, '').trim();

  return (
    <div className="whitespace-pre-wrap">
      {textWithoutUrls}
      {uniqueUrls.length > 0 && (
        <div className="mt-3 pt-3 border-t border-slate-100">
          {uniqueUrls.map((url, i) => (
            <a 
              key={i} 
              href={url} 
              target="_blank" 
              rel="noopener noreferrer" 
              className={`font-bold flex items-center gap-1 break-all underline decoration-dotted mb-1 ${isUser ? 'text-white' : ''}`}
              style={!isUser ? { color: THEME_COLOR } : {}}
            >
              {isUser ? '参考記事はこちら' : 'ブログ記事を詳しく見る'} <ExternalLink size={12} />
            </a>
          ))}
        </div>
      )}
    </div>
  );
};

export default function App() {
  const [isOpen, setIsOpen] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [dynamicKnowledge, setDynamicKnowledge] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fetchPosts = async () => {
      try {
        const res = await fetch(WP_API_BASE);
        const posts = await res.json();
        const knowledgeText = posts
          .filter((p: WPPost) => !p.title.rendered.includes("除外"))
          .map((p: WPPost) => (
            `タイトル: ${p.title.rendered}\n内容: ${stripHtml(p.excerpt.rendered)}\nURL: ${p.link}`
          )).join("\n\n---\n\n");
        setDynamicKnowledge(knowledgeText);
      } catch {
        setDynamicKnowledge("過去のブログ記事を参照して回答してください。");
      }
    };

    fetchPosts();

    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) setMessages(parsed);
      } catch { /* ignore */ }
    }
    
    setMessages(prev => prev.length > 0 ? prev : [{ 
      role: 'assistant', 
      content: 'こんにちは！yumionの分身AIだよ。キャリアやお金の悩み、僕の実体験からサクッと答えるね。' 
    }]);
    
    setIsInitialized(true);
  }, []);

  useEffect(() => {
    if (isInitialized && messages.length > 0) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    }
    scrollToBottom();
  }, [messages, isInitialized]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const clearHistory = () => {
    const initialMessage: Message[] = [{ role: 'assistant', content: '履歴をリセットしたよ。またいつでも相談してね！' }];
    setMessages(initialMessage);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(initialMessage));
    setShowConfirm(false);
  };

  const handleSendMessage = async (text: string) => {
    if (!text.trim() || isLoading) return;
    
    if (!API_KEY) {
      setMessages(prev => [...prev, { role: 'assistant', content: '【設定案内】デプロイ後にAPIキーを設定すると正常に動作します。' }]);
      return;
    }

    const userMsg: Message = { role: 'user', content: text };
    setMessages(prev => [...prev, userMsg]);
    setInputValue('');
    setIsLoading(true);

    try {
      const payload = {
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT_TEMPLATE(dynamicKnowledge) }] },
        contents: [
          ...messages.map(m => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }]
          })),
          { role: 'user', parts: [{ text: text }] }
        ]
      };

      const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await response.json();
      const aiText = data.candidates?.[0]?.content?.parts?.[0]?.text;
      
      if (aiText) {
        setMessages(prev => [...prev, { role: 'assistant', content: aiText }]);
      }
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'ごめんね、エラーが出ちゃったみたい。もう一度送ってみてくれるかな？' }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="bg-transparent">
      {/* 埋め込み用に不要な背景セクションを削除しました */}

      {isOpen && (
        <div className="fixed bottom-24 right-6 w-90 h-130 bg-white rounded-3xl shadow-2xl flex flex-col border border-slate-100 overflow-hidden z-50 animate-in fade-in slide-in-from-bottom-4">
          {showConfirm && (
            <div className="absolute inset-0 z-60 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-8">
              <div className="bg-white rounded-3xl p-8 shadow-2xl w-full text-center">
                <div className="mx-auto w-16 h-16 bg-red-50 text-red-500 rounded-full flex items-center justify-center mb-6"><AlertTriangle size={32} /></div>
                <h4 className="font-bold text-slate-800 text-lg mb-2">履歴を消してもいい？</h4>
                <div className="space-y-3 mt-8">
                  <button onClick={clearHistory} className="w-full py-3 rounded-xl bg-red-500 text-white text-sm font-bold shadow-lg shadow-red-200">はい、消去します</button>
                  <button onClick={() => setShowConfirm(false)} className="w-full py-3 rounded-xl bg-slate-100 text-slate-600 text-sm font-bold">やっぱりやめる</button>
                </div>
              </div>
            </div>
          )}

          <div className="p-5 text-white flex justify-between items-center shrink-0" style={{ backgroundColor: THEME_COLOR }}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center shadow-inner"><Bot size={22} /></div>
              <p className="font-bold text-sm tracking-tight">yumion AI Mentor</p>
            </div>
            <div className="flex gap-1">
              <button onClick={() => setShowConfirm(true)} className="hover:bg-white/10 p-2 rounded-full text-white/50 hover:text-white"><Trash2 size={18} /></button>
              <button onClick={() => setIsOpen(false)} className="hover:bg-white/10 p-2 rounded-full"><X size={18} /></button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 bg-slate-50/50 space-y-4">
            {messages.map((msg, idx) => (
              <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] p-3.5 rounded-2xl text-[13px] shadow-sm leading-relaxed ${
                  msg.role === 'user' ? 'text-white rounded-br-none' : 'bg-white text-slate-700 border border-slate-200 rounded-bl-none'
                }`}
                style={msg.role === 'user' ? { backgroundColor: THEME_COLOR } : {}}
                >
                  <LinkifiedText content={msg.content} isUser={msg.role === 'user'} />
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="flex justify-start">
                <div className="bg-white px-4 py-2 rounded-full border border-slate-200 shadow-sm flex items-center gap-2">
                  <Loader2 size={14} className="animate-spin" style={{ color: THEME_COLOR }} />
                  <span className="text-[11px] text-slate-400">yumionが考え中...</span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="px-4 py-2 bg-white flex gap-2 overflow-x-auto no-scrollbar border-t border-slate-50 shrink-0">
            {QUICK_QUESTIONS.map((q, i) => (
              <button key={i} onClick={() => { if(!isLoading) handleSendMessage(q); }} className="shrink-0 bg-white border border-slate-200 text-slate-600 px-3 py-1.5 rounded-full text-[10px] font-medium shadow-sm flex items-center gap-1">
                <Sparkles size={10} style={{ color: THEME_COLOR }} />{q}
              </button>
            ))}
          </div>

          <div className="p-4 bg-white border-t border-slate-100 shrink-0">
            <div className="flex gap-2">
              <input 
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => {
                  // 日本語変換中（isComposing）は送信しないように修正
                  //  if(e.key === 'Enter') 
                  if(e.key === 'Enter' && !e.nativeEvent.isComposing)
                    handleSendMessage(inputValue);
                  }}
                  placeholder="悩みを聞かせてね！"
                  className="flex-1 bg-slate-100 border-none rounded-xl px-4 py-3 text-sm focus:ring-2 outline-none transition-all"
                  style={{ caretColor: THEME_COLOR }}
              />
              <button onClick={() => handleSendMessage(inputValue)} disabled={!inputValue.trim() || isLoading} className="text-white p-3 rounded-xl disabled:bg-slate-200 transition-colors shadow-lg" style={!inputValue.trim() || isLoading ? {} : { backgroundColor: THEME_COLOR }}>
                <Send size={18} />
              </button>
            </div>
          </div>
        </div>
      )}

      <button onClick={() => setIsOpen(!isOpen)} className={`fixed bottom-8 right-8 w-16 h-16 rounded-full shadow-2xl flex items-center justify-center transition-all z-50 hover:scale-110 active:scale-95 ${isOpen ? 'bg-slate-800 rotate-90 scale-90' : ''}`} style={!isOpen ? { backgroundColor: THEME_COLOR } : {}}>
        {isOpen ? <X size={28} className="text-white" /> : <MessageCircle size={30} className="text-white" />}
      </button>
    </div>
  );
}