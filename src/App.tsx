
import { useState, useEffect, useRef } from 'react';
import { MessageCircle, X, Send, Bot, Loader2, Sparkles, Trash2, ExternalLink, AlertTriangle } from 'lucide-react';
// Firebase SDK
import { initializeApp, getApp, getApps } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged, type User } from 'firebase/auth';
import { getFirestore, collection, doc, setDoc, getDoc, getDocs, type DocumentData } from 'firebase/firestore';

// --- Types ---
interface WPPost {
  id: number;
  title: { rendered: string };
  excerpt: { rendered: string };
  content: { rendered: string };
  link: string;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

// Windowオブジェクトの拡張定義（型エラー対策）
interface CustomWindow extends Window {
  __firebase_config?: string;
  __app_id?: string;
  __initial_auth_token?: string;
}

declare const window: CustomWindow;

// --- Firebase Configuration ---
const getFirebaseConfig = () => {
  try {
    if (typeof window.__firebase_config !== 'undefined') {
      return JSON.parse(window.__firebase_config);
    }
    // "@ts-expect-error: import.meta.env is only available in Vite environments"
    const configStr = import.meta?.env?.VITE_FIREBASE_CONFIG;
    if (configStr) return JSON.parse(configStr);
  } catch (e) {
    console.error("Firebase Config Error:", e);
  }
  return null;
};

const firebaseConfig = getFirebaseConfig();
const app = (firebaseConfig && firebaseConfig.apiKey) ? (getApps().length > 0 ? getApp() : initializeApp(firebaseConfig)) : null;
const auth = app ? getAuth(app) : null;
const db = app ? getFirestore(app) : null;
const APP_ID = window.__app_id || 'yumion-ai';

// --- AI Configuration ---
// APIキーを取得するロジックを修正
const getApiKey = (): string => {
  try {
    // "@ts-expect-error: import.meta.env is only available in Vite"
    return import.meta?.env?.VITE_GEMINI_API_KEY || "";
  } catch {
    return "";
  }
};

const apiKey = getApiKey();
const MODEL_NAME = "gemini-2.5-flash-preview-09-2025";
const EMBED_MODEL = "text-embedding-004";
// APIキーが空でないことを確認してURLを構築
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${apiKey}`;
const EMBED_URL = `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:embedContent?key=${apiKey}`;
const STORAGE_KEY = 'yumion_ai_chat_history_v9'; 

const WP_API_BASE = "https://yumion3blog.com/wp-json/wp/v2/posts?per_page=100"; 
const THEME_COLOR = "#359ec4";

// --- Helpers (コンポーネント外に配置して再生成を防止)---

// 埋め込みベクトルを生成する関数 (Exponential Backoff実装)
const generateEmbedding = async (text: string, retryCount = 0): Promise<number[] | null> => {
  if (!apiKey) {
    console.error("Gemini API Key is missing for Embedding.");
    return null;
  }
  try {
    const response = await fetch(EMBED_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: `models/${EMBED_MODEL}`,
        content: { parts: [{ text }] }
      })
    });
    if (!response.ok) throw new Error(`Embedding API Error: ${response.status}`);
    const data = await response.json();
    return data.embedding?.values || null;
  } catch (e) {
    if (retryCount < 3) {
      const delay = Math.pow(2, retryCount) * 1000;
      await new Promise(r => setTimeout(r, delay));
      return generateEmbedding(text, retryCount + 1);
    }
    console.error("Embedding Generation Failed", e);
    return null;
  }
};

const stripHtml = (html: string, limit = 1000) => {
  const plainText = html.replace(/<[^>]*>?/gm, '');
  return plainText.length > limit ? plainText.substring(0, limit) + "..." : plainText;
};

const cosineSimilarity = (vecA: number[], vecB: number[]) => {
  const dotProduct = vecA.reduce((sum, a, i) => sum + a * vecB[i], 0);
  const magA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
  const magB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));
  if (magA === 0 || magB === 0) return 0;
  return dotProduct / (magA * magB);
};

const SYSTEM_PROMPT_TEMPLATE = (knowledge: string) => `
あなたはブログ「フリログ」運営者「yumion」の分身AIメンターです。
提供された【ブログ記事データ】を知識の根拠として、相談者の不安を解消してください。

【ブログ記事データ】
${knowledge}

【回答ルール】
1. キャラクター: 30代の穏やかで頼れる兄貴分。親しみやすく、柔らかい言葉遣いで。
2. 回答構成:
   - 【結論】: 質問に対する答えを一言で。その後に空行。
   - 【ポイント】: 1. 2. 3. と番号付きリストで3点以内。その後に空行。
   - ラベルなし: 「この記事に詳しく書いたよ！」と添えて、最も関連性の高い記事のURLを1つだけ提示。
3. 表記制限: 強調は「 」（カギカッコ）を使用。Markdownの太字(**)は禁止。
4. URL制限: 提示するURLは必ず「1つだけ」に絞る。
5. 立ち位置: 営業→エンジニア→フリーランス→会社員という実体験に基づくアドバイスを行う。
`;

const QUICK_QUESTIONS = ["未経験からエンジニアになれる？", "フリーランスの節税を教えて", "会社員に戻るってどう？", "質問のコツが知りたい"];

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
            <a key={i} href={url} target="_blank" rel="noopener noreferrer" className={`font-bold flex items-center gap-1 break-all underline decoration-dotted mb-1 ${isUser ? 'text-white' : ''}`} style={!isUser ? { color: THEME_COLOR } : {}}>
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
  const [user, setUser] = useState<User | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 1. Auth Initialization (RULE 3)
  useEffect(() => {
    if (!auth) return;
    const initAuth = async () => {
      try {
        const token = window.__initial_auth_token;
        if (token) await signInWithCustomToken(auth, token);
        else await signInAnonymously(auth);
      } catch (e) { console.error("Auth Error", e); }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  // 2. Data Synchronization (WordPress -> Firestore)
  useEffect(() => {
    if (!user || !db) return;
    const syncPosts = async () => {
      try {
        const res = await fetch(WP_API_BASE);
        const posts: WPPost[] = await res.json();
        const postsCollection = collection(db, 'artifacts', APP_ID, 'public', 'data', 'posts');

        for (const p of posts) {
          const postDocRef = doc(postsCollection, p.id.toString());
          const snap = await getDoc(postDocRef);
          
          if (!snap.exists() || !snap.data().embedding) {
            const title = p.title.rendered;
            const body = stripHtml(p.content.rendered, 1000);
            const embedding = await generateEmbedding(`${title}\n${body}`);
            
            await setDoc(postDocRef, {
              title,
              excerpt: stripHtml(p.excerpt.rendered, 200),
              body,
              link: p.link,
              embedding,
              updatedAt: new Date().toISOString()
            }, { merge: true });
          }
        }
      } catch (e) { console.error("Sync Error", e); }
    };
    syncPosts();
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) setMessages(parsed);
      } catch { /* ignore */ }
    }
    setMessages(prev => prev.length > 0 ? prev : [{ role: 'assistant', content: 'こんにちは！yumionの分身AIだよ。ブログの全記事から「意味」を汲み取って、最適なアドバイスをするね。' }]);
    setIsInitialized(true);
  }, [user]);

  useEffect(() => {
    if (isInitialized && messages.length > 0) localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    scrollToBottom();
  }, [messages, isInitialized]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  // --- RAG: ベクトル検索Logic ---
  const searchRelatedKnowledge = async (queryText: string) => {
    if (!db) return "知識ベースへのアクセス権がありません。";
    try {
      const postsCollection = collection(db, 'artifacts', APP_ID, 'public', 'data', 'posts');
      // RULE 2: 全てを取得する
      const querySnapshot = await getDocs(postsCollection);
      const allPosts: DocumentData[] = querySnapshot.docs.map(d => d.data());

      const queryEmbedding = await generateEmbedding(queryText);

      let results: DocumentData[] = [];

      if (queryEmbedding) {
        // コサイン類似度で意味の近さを計算
        const scoredPosts = allPosts
          .filter(p => p.embedding)
          .map(p => ({ 
            ...p, 
            score: cosineSimilarity(queryEmbedding, p.embedding as number[]) 
          }))
          .sort((a, b) => (b.score || 0) - (a.score || 0));
        
          // スコアが高い上位4件を抽出
          results = scoredPosts.slice(0, 4);
      }

      // ベクトル検索で十分な結果が出なかった場合のフォールバック（キーワード検索）
      if (results.length === 0) {
        const terms = queryText.toLowerCase().split(/[\s,、。！？]+/).filter(t => t.length > 1);
        results = allPosts.filter(p => 
          terms.some(t => p.title?.toLowerCase().includes(t) || p.body?.toLowerCase().includes(t))
        ).slice(0, 3);
      }

      // それでも空なら最新記事
      if (results.length === 0) results = allPosts.slice(0, 2);
      
      return results.map(p => `タイトル: ${p.title}\n内容: ${p.body || p.excerpt}\nURL: ${p.link}`).join("\n\n---\n\n");
    } catch (e) {
      console.error("Search Error", e);
      return "情報を検索できませんでした。一般的なキャリア知識で回答します。";
    }
  };

  const handleSendMessage = async (text: string) => {
    if (!text.trim() || isLoading) return;
    if (!apiKey) {
      setMessages(prev => [...prev, { role: 'assistant', content: 'APIキーが設定されていないみたい。環境変数を確認してみてね。' }]);
      return;
    }

    const userMsg: Message = { role: 'user', content: text };
    setMessages(prev => [...prev, userMsg]);
    setInputValue('');
    setIsLoading(true);

    try {
      const knowledge = await searchRelatedKnowledge(text);

      const generateContent = async (retryCount = 0): Promise<unknown> => {
        try {
          const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: `User Query: ${text}\n\nContext:\n${knowledge}` }] }],
              systemInstruction: { parts: [{ text: SYSTEM_PROMPT_TEMPLATE(knowledge) }] }
            })
          });
          if (!response.ok) throw new Error(`Gemini API Error: ${response.status}`);
          return await response.json();
        } catch (e) {
          if (retryCount < 5) {
            const delay = Math.pow(2, retryCount) * 1000;
            await new Promise(r => setTimeout(r, delay));
            return generateContent(retryCount + 1);
          }
          throw e;
        }
      };

      const result = await generateContent() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
      const aiResponse = result.candidates?.[0]?.content?.parts?.[0]?.text;
      
      if (aiResponse) {
        setMessages(prev => [...prev, { role: 'assistant', content: aiResponse }]);
      }
    } catch (e) {
      console.error("Handle Message Error", e);
      setMessages(prev => [...prev, { role: 'assistant', content: 'ごめんね、ちょっと考えがまとまらなかったみたい。もう一度送ってみて！' }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="bg-transparent h-screen w-screen relative overflow-hidden font-sans">
      {isOpen && (
        <div className="fixed bottom-24 right-6 w-90 h-130 bg-white rounded-3xl shadow-2xl flex flex-col border border-slate-100 overflow-hidden z-50 animate-in fade-in slide-in-from-bottom-4">
          {showConfirm && (
            <div className="absolute inset-0 z-60 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-8">
              <div className="bg-white rounded-3xl p-8 shadow-2xl w-full text-center">
                <div className="mx-auto w-16 h-16 bg-red-50 text-red-500 rounded-full flex items-center justify-center mb-6"><AlertTriangle size={32} /></div>
                <h4 className="font-bold text-slate-800 text-lg mb-2">履歴を消してもいい？</h4>
                <div className="space-y-3 mt-8">
                  <button onClick={() => { setMessages([{ role: 'assistant', content: 'リセットしたよ。' }]); localStorage.removeItem(STORAGE_KEY); setShowConfirm(false); }} className="w-full py-3 rounded-xl bg-red-500 text-white text-sm font-bold shadow-lg shadow-red-200">はい、消去します</button>
                  <button onClick={() => setShowConfirm(false)} className="w-full py-3 rounded-xl bg-slate-100 text-slate-600 text-sm font-bold">やっぱりやめる</button>
                </div>
              </div>
            </div>
          )}
          <div className="p-5 text-white flex justify-between items-center shrink-0" style={{ backgroundColor: THEME_COLOR }}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center shadow-inner"><Bot size={22} /></div>
              <div>
                <p className="font-bold text-sm tracking-tight leading-none">yumion AI Mentor</p>
                <p className="text-[10px] text-white/70 mt-1 uppercase">Semantic Engine v2.0</p>
              </div>
            </div>
            <div className="flex gap-1">
              <button onClick={() => setShowConfirm(true)} className="hover:bg-white/10 p-2 rounded-full text-white/50 hover:text-white transition-colors"><Trash2 size={18} /></button>
              <button onClick={() => setIsOpen(false)} className="hover:bg-white/10 p-2 rounded-full transition-colors"><X size={18} /></button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-4 bg-slate-50/50 space-y-4 scroll-smooth">
            {messages.map((msg, idx) => (
              <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] p-3.5 rounded-2xl text-[13px] shadow-sm leading-relaxed ${msg.role === 'user' ? 'text-white rounded-br-none' : 'bg-white text-slate-700 border border-slate-200 rounded-bl-none'}`} style={msg.role === 'user' ? { backgroundColor: THEME_COLOR } : {}}>
                  <LinkifiedText content={msg.content} isUser={msg.role === 'user'} />
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="flex justify-start">
                <div className="bg-white px-4 py-2 rounded-full border border-slate-200 shadow-sm flex items-center gap-2">
                  <Loader2 size={14} className="animate-spin" style={{ color: THEME_COLOR }} />
                  <span className="text-[11px] text-slate-400">最適な知恵を検索中...</span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
          <div className="px-4 py-2 bg-white flex gap-2 overflow-x-auto no-scrollbar border-t border-slate-50 shrink-0">
            {QUICK_QUESTIONS.map((q, i) => (
              <button key={i} onClick={() => { if(!isLoading) handleSendMessage(q); }} className="shrink-0 bg-white border border-slate-200 text-slate-600 px-3 py-1.5 rounded-full text-[10px] font-medium shadow-sm flex items-center gap-1 hover:bg-slate-50 transition-colors">
                <Sparkles size={10} style={{ color: THEME_COLOR }} />{q}
              </button>
            ))}
          </div>
          <div className="p-4 bg-white border-t border-slate-100 shrink-0">
            <div className="flex gap-2">
              <input type="text" value={inputValue} onChange={(e) => setInputValue(e.target.value)} onKeyDown={(e) => { if(e.key === 'Enter' && !e.nativeEvent.isComposing) handleSendMessage(inputValue); }} placeholder="キャリアやお金の悩み、聞かせてね！" className="flex-1 bg-slate-100 border-none rounded-xl px-4 py-3 text-sm focus:ring-2 outline-none transition-all" style={{ caretColor: THEME_COLOR }} />
              <button onClick={() => handleSendMessage(inputValue)} disabled={!inputValue.trim() || isLoading} className="text-white p-3 rounded-xl disabled:bg-slate-200 transition-all shadow-lg hover:brightness-110 active:scale-95" style={!inputValue.trim() || isLoading ? {} : { backgroundColor: THEME_COLOR }}><Send size={18} /></button>
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