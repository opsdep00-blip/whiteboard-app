
"use client";

// 差分が大きい場合は新規ページとして追加する
function isLargeDifference(local: any, remote: any): boolean {
  if (!local || !remote) return false;
  if (local.title !== remote.title) return true;
  if ((local.body || "") !== (remote.body || "")) return true;
  const arrFields = ["cards", "items", "nodes", "textBoxes"];
  for (const key of arrFields) {
    const lArr = local[key] || [];
    const rArr = remote[key] || [];
    if (Math.abs(lArr.length - rArr.length) > 2) return true;
    const lIds = lArr.map((x: any) => x.id);
    const rIds = rArr.map((x: any) => x.id);
    const diff = lIds.filter((id: any) => !rIds.includes(id)).length + rIds.filter((id: any) => !lIds.includes(id)).length;
    if (diff > 2) return true;
  }
  return false;
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  GoogleAuthProvider,
  User,
  onAuthStateChanged,
  signInWithPopup,
  signOut
} from "firebase/auth";
import { collection, deleteDoc, doc, getDoc, getDocs, query, runTransaction, setDoc, where } from "firebase/firestore";
import { auth, db } from "../src/lib/firebase";
import type { MouseEvent as ReactMouseEvent, WheelEvent as ReactWheelEvent, ReactNode } from "react";
import { FcAlphabeticalSortingAz, FcFaq, FcFile, FcLock, FcMindMap, FcSettings } from "react-icons/fc";
import { GoSidebarCollapse, GoSidebarExpand } from "react-icons/go";
import { RxDoubleArrowDown, RxDoubleArrowUp } from "react-icons/rx";
import { savePreviewPayload } from "../lib/previewStorage";

type Theme = "dark" | "light";
const THEME_STORAGE_KEY = "whiteboard-theme";
const LOCAL_DATA_PREFIX = "whiteboard-local-data";

type BoardType = "proposal" | "mindmap" | "ranking" | "qa";

type Board = {
  id: BoardType;
  name: string;
  icon: ReactNode;
  accent: string;
};

type MarkdownPage = {
  id: string;
  boardId: "proposal";
  title: string;
  projectId: string;
  owner?: string;
  version?: number;
  updatedAt?: string;
  content: string;
};

type MindmapSection = {
  id: string;
  text: string;
  fontSize?: number;
};

type MindmapNode = {
  id: string;
  title: string;
  color: string;
  value: number;
  x: number;
  y: number;
  sections: MindmapSection[];
};

type MindmapTextBox = {
  id: string;
  text: string;
  color: string;
  value: number;
  x: number;
  y: number;
  fontSize?: number;
};

type MindmapConnector = {
  nodeId?: string;
  sectionId?: string;
  textBoxId?: string;
  side?: "left" | "right";
};

type MindmapLink = {
  id: string;
  from: MindmapConnector;
  to: MindmapConnector;
};

type MindmapPage = {
  id: string;
  boardId: "mindmap";
  title: string;
  projectId: string;
  owner?: string;
  version?: number;
  updatedAt?: string;
  nodes: MindmapNode[];
  textBoxes?: MindmapTextBox[];
  links: MindmapLink[];
};

type RankingItem = {
  id: string;
  title: string;
  body: string;
};

type RankingPage = {
  id: string;
  boardId: "ranking";
  title: string;
  projectId: string;
  owner?: string;
  version?: number;
  updatedAt?: string;
  items: RankingItem[];
  note?: string;
};

type QAAnswer = {
  id: string;
  text: string;
  createdAt: string;
};

type QACard = {
  id: string;
  title: string;
  description: string;
  answers: QAAnswer[];
  createdAt: string;
};

type QAPage = {
  id: string;
  boardId: "qa";
  title: string;
  projectId: string;
  owner?: string;
  version?: number;
  updatedAt?: string;
  cards: QACard[];
};

type Page = MarkdownPage | MindmapPage | RankingPage | QAPage;

type Project = {
  id: string;
  name: string;
  owner?: string;
  version?: number;
  updatedAt?: string;
};

type ConflictItem = {
  kind: "project" | "page";
  id: string;
  local: Project | Page;
  remote: Project | Page;
};

type LocalAccount = {
  name: string;
  key: string;
};

type LocalPersistedData = {
  projects: Project[];
  pages: Page[];
  activeProjectId: string;
  activePageId: string;
};

const boards: Board[] = [
  { id: "proposal", name: "企画書", icon: <FcFile size={18} />, accent: "#3b82f6" },
  { id: "mindmap", name: "ダイアグラム", icon: <FcMindMap size={18} />, accent: "#ec4899" },
  { id: "ranking", name: "ランキング", icon: <FcAlphabeticalSortingAz size={18} />, accent: "#eab308" },
  { id: "qa", name: "Q&A", icon: <FcFaq size={18} />, accent: "#0ea5e9" }
];

const initialProjects: Project[] = [
  { id: "default-project", name: "プロジェクトA", version: 0, updatedAt: new Date().toISOString() }
];

const DEFAULT_PROJECT_ID = initialProjects[0]?.id ?? "default-project";

const TIMESTAMP_TOKEN = "__LAST_UPDATED__";
const PROJECT_TOKEN = "__PROJECT_TITLE__";

const markdownTemplate = `---
owner: your-name
persona: product manager
kpi: session-length, retention
last-updated: ${TIMESTAMP_TOKEN}
---

# Project: ${PROJECT_TOKEN}

## Why now?
- Need a lightweight way to co-create企画書 in Markdown.
- Cloud Run + Firestore keep infra within the free tier when idle.

## Requirements
1. Multi-user editing with optimistic UI.
2. Reusable proposal templates.
3. Export-friendly .md for GitHub Copilot prompts.

## Cost Guardrails
- Stay inside Cloud Run free tier (0 min instances).
- Prefer Firestore reads batching + memoized caches.
- Snapshot archives go to Cloud Storage or GitHub.

## Next steps
- [ ] Flesh out Firestore security rules.
- [ ] Build editor presence indicators.
- [ ] Automate Cloud Run deploy pipeline.
`;

const MINDMAP_WIDTH = 1800;
const MINDMAP_HEIGHT = 1200;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 1.6;
const ZOOM_STEP = 0.1;
const DEFAULT_NODE_TITLE = "パネル";
const DEFAULT_NODE_COLOR = "#8B0000";
const NODE_COLOR_PRESETS = [
  "#8B0000",
  "#00008B",
  "#8B8B00",
  "#006400",
  "#660000", "#8B0000", "#AA0000", "#CC1111",
  "#003366", "#004499", "#0066BB", "#0088DD",
  "#666600", "#888800", "#AAAA00", "#CCCC11",
  "#006633", "#008844", "#00AA55", "#00CC66",
  "#663333", "#884444", "#AA5555", "#CC6666",
  "#330066", "#550088", "#7700AA", "#9900CC",
  "#663366", "#885588", "#AA66AA", "#CC77CC",
  "#006666", "#008888", "#00AAAA", "#00CCCC"
];
const NODE_WIDTH = 200;
const NODE_HEADER_HEIGHT = 42;
const NODE_SECTION_HEIGHT = 64;
const NODE_SECTION_GAP = 10;

const getSectionAnchorPosition = (node: MindmapNode, section: MindmapSection, side: "left" | "right" = "right") => {
  const sectionIndex = node.sections.findIndex((s) => s.id === section.id);
  let cumulativeHeight = 0;
  for (let i = 0; i < sectionIndex; i++) {
    const lines = Math.max(1, ((node.sections[i].text ?? "").match(/\n/g) || []).length + 1);
    const fontSize = node.sections[i].fontSize ?? 12;
    const lineHeight = 1.2;
    const padding = 5.6;
    const height = Math.max(64, lines * fontSize * lineHeight + padding);
    cumulativeHeight += height;
  }
  const lines = Math.max(1, ((section.text ?? "").match(/\n/g) || []).length + 1);
  const fontSize = section.fontSize ?? 12;
  const lineHeight = 1.2;
  const padding = 5.6;
  const sectionHeight = Math.max(64, lines * fontSize * lineHeight + padding);
  const headerHeight = 28;
  const sectionTop = headerHeight + cumulativeHeight;
  const sectionCenterY = sectionTop + sectionHeight / 2 + 8;
  return {
    x: side === "left" ? node.x : node.x + 200,
    y: node.y + sectionCenterY
  };
};

const getTextBoxAnchorPosition = (textBox: MindmapTextBox, side: "left" | "right" = "right") => {
  return {
    x: textBox.x,
    y: textBox.y + 20
  };
};

const createId = (prefix: string) =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const getLocalAccountDataKey = (account: LocalAccount) =>
  `${LOCAL_DATA_PREFIX}:${account.name}:${account.key}`;

const getChangedItems = <T extends { id: string }>(current: T[], last: T[]) => {
  const lastMap = new Map(last.map((item) => [item.id, JSON.stringify(item)]));
  return current.filter((item) => {
    const serialized = JSON.stringify(item);
    const prevSerialized = lastMap.get(item.id);
    return !prevSerialized || prevSerialized !== serialized;
  });
};

const nowIso = () => new Date().toISOString();

const isProjectEntity = (item: Project | Page): item is Project => !("boardId" in item);

const persistProjectWithVersion = async (project: Project, ownerId: string) => {
  const ref = doc(db, "projects", project.id);
  const updatedAt = nowIso();
  const version = await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data() as Project | undefined;
    const remoteVersion = typeof data?.version === "number" ? data.version : 0;
    const currentVersion = typeof project.version === "number" ? project.version : 0;
    if (snap.exists() && remoteVersion !== currentVersion) {
      throw new Error("version-mismatch");
    }
    const nextVersion = (snap.exists() ? remoteVersion : currentVersion) + 1;
    tx.set(ref, { ...project, owner: ownerId, version: nextVersion, updatedAt });
    return nextVersion;
  });
  return { id: project.id, version, updatedAt } as const;
};

const persistPageWithVersion = async (page: Page, ownerId: string) => {
  const ref = doc(db, "pages", page.id);
  const updatedAt = nowIso();
  const version = await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data() as Page | undefined;
    const remoteVersion = typeof (data as any)?.version === "number" ? (data as any).version : 0;
    const currentVersion = typeof (page as any).version === "number" ? (page as any).version : 0;
    if (snap.exists() && remoteVersion !== currentVersion) {
      throw new Error("version-mismatch");
    }
    const nextVersion = (snap.exists() ? remoteVersion : currentVersion) + 1;
    tx.set(ref, { ...page, owner: ownerId, version: nextVersion, updatedAt });
    return nextVersion;
  });
  return { id: page.id, version, updatedAt } as const;
};

const fetchRemoteProject = async (id: string): Promise<Project | null> => {
  const ref = doc(db, "projects", id);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  const data = snap.data() as Project;
  return {
    ...data,
    id: snap.id,
    version: typeof data.version === "number" ? data.version : 0,
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : undefined
  };
};

const fetchRemotePage = async (id: string): Promise<Page | null> => {
  const ref = doc(db, "pages", id);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  const data = snap.data() as Page;
  return {
    ...data,
    id: snap.id,
    version: typeof (data as any).version === "number" ? (data as any).version : 0,
    updatedAt: typeof (data as any).updatedAt === "string" ? (data as any).updatedAt : undefined
  } as Page;
};

const createSection = (text: string): MindmapSection => ({
  id: createId("section"),
  text
});

const createRankingItem = (title: string = "", body: string = ""): RankingItem => ({
  id: createId("ranking"),
  title,
  body
});

const createMarkdownPage = (title: string, projectId: string): MarkdownPage => ({
  id: createId("proposal"),
  boardId: "proposal",
  title,
  projectId,
  version: 0,
  updatedAt: new Date().toISOString(),
  content: ""
});

const createMindmapPage = (title: string, projectId: string): MindmapPage => ({
  id: createId("mindmap"),
  boardId: "mindmap",
  title,
  projectId,
  version: 0,
  updatedAt: new Date().toISOString(),
  nodes: [],
  textBoxes: [],
  links: []
});

const createRankingPage = (title: string, projectId: string): RankingPage => ({
  id: createId("ranking-page"),
  boardId: "ranking",
  title,
  projectId,
  version: 0,
  updatedAt: new Date().toISOString(),
  items: []
});

const createQAAnswer = (text: string): QAAnswer => ({
  id: createId("qa-answer"),
  text,
  createdAt: new Date().toISOString()
});

const createQACard = (title: string = "", description: string = "", answers: QAAnswer[] = []): QACard => ({
  id: createId("qa-card"),
  title,
  description,
  answers,
  createdAt: new Date().toISOString()
});

const createQAPage = (title: string, projectId: string): QAPage => ({
  id: createId("qa-page"),
  boardId: "qa",
  title,
  projectId,
  version: 0,
  updatedAt: new Date().toISOString(),
  cards: []
});

const createDefaultPagesForProject = (_projectId: string): Page[] => [];

const INITIAL_PAGES_FOR_DEFAULT_PROJECT: Page[] = [];

const isMarkdownPage = (page: Page | null): page is MarkdownPage => !!page && page.boardId === "proposal";
const isMindmapPage = (page: Page | null): page is MindmapPage => !!page && page.boardId === "mindmap";
const isRankingPage = (page: Page | null): page is RankingPage => !!page && page.boardId === "ranking";
const isQAPage = (page: Page | null): page is QAPage => !!page && page.boardId === "qa";

export default function HomePage() {
  const [theme, setTheme] = useState<Theme>("light");
  const [projects, setProjects] = useState<Project[]>(initialProjects);
  const [pages, setPages] = useState<Page[]>(INITIAL_PAGES_FOR_DEFAULT_PROJECT);
  const [selectedBoardId, setSelectedBoardId] = useState<BoardType>("proposal");
  const [activeProjectId, setActiveProjectId] = useState<string>(DEFAULT_PROJECT_ID);
  const [newProjectName, setNewProjectName] = useState("");
  const [projectRenameDraft, setProjectRenameDraft] = useState("");
  const [isProjectMenuOpen, setIsProjectMenuOpen] = useState(false);
  const [isPageMenuOpen, setIsPageMenuOpen] = useState(false);
  const [activePageId, setActivePageId] = useState<string>(INITIAL_PAGES_FOR_DEFAULT_PROJECT[0]?.id ?? "");
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [localAccount, setLocalAccount] = useState<LocalAccount | null>(null);
  const [activeAccountId, setActiveAccountId] = useState<string | null>(null);
  const [accountMessage, setAccountMessage] = useState("");
  const [isAccountModalOpen, setIsAccountModalOpen] = useState(false);
  const [accountNameInput, setAccountNameInput] = useState("");
  const [accountKeyInput, setAccountKeyInput] = useState("");
  const [pendingConflict, setPendingConflict] = useState<ConflictItem | null>(null);
  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) ?? null,
    [projects, activeProjectId]
  );
  const activeAccountLabel = useMemo(() => {
    if (firebaseUser?.displayName) return firebaseUser.displayName;
    if (firebaseUser?.email) return firebaseUser.email;
    if (localAccount?.name) return localAccount.name;
    return null;
  }, [firebaseUser?.displayName, firebaseUser?.email, localAccount?.name]);
  const isLoggedIn = !!firebaseUser || !!localAccount;
  // Googleアカウントならuid、ローカルアカウントならname+keyのハッシュ
  const getLocalAccountOwnerId = (account: LocalAccount | null) => {
    if (!account) return null;
    // シンプルなハッシュ（本番はより安全な方法を推奨）
    return `local_${btoa(encodeURIComponent(account.name + ':' + account.key))}`;
  };
  const currentOwnerId = useMemo(() => {
    let id = null;
    if (firebaseUser?.uid) id = firebaseUser.uid;
    else if (localAccount) id = getLocalAccountOwnerId(localAccount);
    // デバッグ用: ログイン時のownerIdを出力
    if (id) {
      console.log("[DEBUG] currentOwnerId:", id);
    }
    return id;
  }, [firebaseUser?.uid, localAccount]);
  const lastPersistedProjectsRef = useRef<Project[]>(initialProjects);
  const lastPersistedPagesRef = useRef<Page[]>(INITIAL_PAGES_FOR_DEFAULT_PROJECT);
  // 未ログイン時のみlocalStorageを使う
  const persistLocalData = useCallback(() => {
    if (firebaseUser || localAccount) return; // ログイン済みなら使わない
    if (typeof window === "undefined") return;
    const payload: LocalPersistedData = {
      projects,
      pages,
      activeProjectId,
      activePageId
    };
    try {
      window.localStorage.setItem("whiteboard-guest-data", JSON.stringify(payload));
    } catch (error) {
      console.error("ローカル保存に失敗しました", error);
    }
  }, [firebaseUser, localAccount, projects, pages, activeProjectId, activePageId]);

  const handleVersionConflict = useCallback(
    async (kind: "project" | "page", id: string, local: Project | Page) => {
      try {
        const remote = kind === "project" ? await fetchRemoteProject(id) : await fetchRemotePage(id);
        if (!remote) {
          setDataMessage("競合検出: リモートデータが見つかりませんでした");
          return;
        }
        setPendingConflict({ kind, id, local, remote });
        setDataMessage("他の端末で更新がありました。どちらを採用するか選択してください。");
      } catch (error) {
        console.error("競合取得に失敗", error);
      }
    },
    []
  );

  const flushPersist = useCallback(async () => {
    // ログイン済み（Google/アカウント名＋キー）はFirestoreのみ
    if (currentOwnerId) {
      if (pendingConflict) {
        setDataMessage("競合解決中です。選択が終わるまで保存できません。");
        return;
      }
      const changedProjects = getChangedItems(projects, lastPersistedProjectsRef.current);
      const changedPages = getChangedItems(pages, lastPersistedPagesRef.current);
      if (changedProjects.length === 0 && changedPages.length === 0) {
        return;
      }
      try {
        const [projectResults, pageResults] = await Promise.all([
          Promise.all(changedProjects.map((project) => persistProjectWithVersion(project, currentOwnerId))),
          Promise.all(changedPages.map((page) => persistPageWithVersion(page, currentOwnerId)))
        ]);
        const updatedProjects = projects.map((project) => {
          const hit = projectResults.find((item) => item.id === project.id);
          return hit ? { ...project, version: hit.version, updatedAt: hit.updatedAt } : project;
        });
        const updatedPages = pages.map((page) => {
          const hit = pageResults.find((item) => item.id === page.id);
          return hit ? { ...page, version: hit.version, updatedAt: hit.updatedAt } : page;
        });
        lastPersistedProjectsRef.current = updatedProjects;
        lastPersistedPagesRef.current = updatedPages;
        setProjects(updatedProjects);
        setPages(updatedPages);
      } catch (error) {
        const isConflict = error instanceof Error && error.message === "version-mismatch";
        if (isConflict) {
          const target = changedProjects[0] ?? changedPages[0];
          if (target) {
            await handleVersionConflict(isProjectEntity(target) ? "project" : "page", target.id, target as any);
            setDataMessage("競合が発生しました。選択が終わるまで保存できません。");
            return;
          }
        } else {
          setDataMessage("即時保存に失敗しました");
        }
        console.error("即時保存に失敗しました", error);
      }
      return;
    }
    // 未ログイン時のみlocalStorage保存
    if (!currentOwnerId && !firebaseUser && !localAccount) {
      persistLocalData();
    }
  }, [currentOwnerId, projects, pages, localAccount, firebaseUser, persistLocalData, handleVersionConflict, pendingConflict]);
  const [linkingFrom, setLinkingFrom] = useState<MindmapConnector | null>(null);
  const [linkingCursor, setLinkingCursor] = useState<{ x: number; y: number } | null>(null);
  const [mindmapScale, setMindmapScale] = useState(1);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedTextBoxId, setSelectedTextBoxId] = useState<string | null>(null);
  const [editingTextBoxId, setEditingTextBoxId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    type: "node" | "section" | "textbox";
    nodeId?: string;
    sectionId?: string;
    textBoxId?: string;
  } | null>(null);
  const [dragging, setDragging] = useState<{
    pageId: string;
    nodeId?: string;
    textBoxId?: string;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const [isBoardsOpen, setIsBoardsOpen] = useState(true);
  const [isToolsOpen, setIsToolsOpen] = useState(true);
  const [draggingRankingItemId, setDraggingRankingItemId] = useState<string | null>(null);
  const [dragOverRankingItemId, setDragOverRankingItemId] = useState<string | null>(null);
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null);
  const [mindmapPan, setMindmapPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [selectedQACardId, setSelectedQACardId] = useState<string | null>(null);
  const [qaAnswerDraft, setQaAnswerDraft] = useState("");
  const [firebaseStatus, setFirebaseStatus] = useState("");
  const [isCheckingFirebase, setIsCheckingFirebase] = useState(false);
  const [isAuthSigningIn, setIsAuthSigningIn] = useState(false);
  const [isDataSyncing, setIsDataSyncing] = useState(false);
  const [dataMessage, setDataMessage] = useState("");

  const resetToLocalDefaults = useCallback(() => {
    setProjects(initialProjects);
    setPages([]);
    setActiveProjectId(DEFAULT_PROJECT_ID);
    setActivePageId("");
    setDataMessage("未ログイン: ローカル初期データを表示中");
  }, []);

  const mindmapCanvasRef = useRef<HTMLDivElement | null>(null);
  const mindmapContainerRef = useRef<HTMLDivElement | null>(null);
  const editingTextBoxRefRef = useRef<HTMLTextAreaElement | null>(null);
  const panStartRef = useRef({ x: 0, y: 0 });
  const projectMenuRef = useRef<HTMLDivElement | null>(null);
  const pageMenuRef = useRef<HTMLDivElement | null>(null);
  const projectsPersistTimerRef = useRef<number | null>(null);
  const pagesPersistTimerRef = useRef<number | null>(null);
  const localPersistTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark") {
      setTheme(stored);
    }
  }, []);

  useEffect(() => {
    if (!accountMessage) return;
    const timer = window.setTimeout(() => setAccountMessage(""), 2600);
    return () => window.clearTimeout(timer);
  }, [accountMessage]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user);
      setActiveAccountId(user?.uid ?? null);
      setAccountMessage("");
      setIsAuthSigningIn(false);
    });
    return unsubscribe;
  }, []);

  // 保存ボタン以外でFirestoreへ書き込まないように自動保存イベントを削除

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = window.localStorage.getItem("whiteboard-local-account");
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as Partial<LocalAccount>;
      if (parsed?.name && parsed?.key) {
        setLocalAccount({ name: parsed.name, key: parsed.key });
        setActiveAccountId(parsed.name);
      }
    } catch (error) {
      console.error("failed to restore local account", error);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (localAccount) {
      window.localStorage.setItem("whiteboard-local-account", JSON.stringify(localAccount));
    } else {
      window.localStorage.removeItem("whiteboard-local-account");
    }
  }, [localAccount]);

  useEffect(() => {
    const loadFromFirestore = async () => {
      if (!currentOwnerId && !localAccount && !firebaseUser) {
        resetToLocalDefaults();
        return;
      }
      setIsDataSyncing(true);
      setDataMessage("Firestoreから読み込み中...");
      setProjects([]);
      setPages([]);
      setActivePageId("");
      try {
        const projectsSnap = await getDocs(query(collection(db, "projects"), where("owner", "==", currentOwnerId)));
        const loadedProjects: Project[] = projectsSnap.docs.map((docSnap) => {
          const data = docSnap.data();
          return {
            id: docSnap.id,
            name: typeof data.name === "string" ? data.name : "無題プロジェクト",
            owner: typeof data.owner === "string" ? data.owner : currentOwnerId,
            version: typeof data.version === "number" ? data.version : 0,
            updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : undefined
          } as Project;
        });

        const nextProjects = loadedProjects.length > 0
          ? loadedProjects.map(p => ({ ...p, owner: p.owner ?? undefined }))
          : [{ id: DEFAULT_PROJECT_ID, name: "プロジェクトA", owner: currentOwnerId ?? undefined }];
        if (loadedProjects.length === 0) {
          await Promise.all(
            nextProjects.map((project) => setDoc(doc(db, "projects", project.id), project))
          );
        }

        setProjects(nextProjects);
        const nextActiveProjectId = nextProjects[0]?.id ?? DEFAULT_PROJECT_ID;
        setActiveProjectId(nextActiveProjectId);

        lastPersistedProjectsRef.current = nextProjects;

        const pagesSnap = await getDocs(query(collection(db, "pages"), where("owner", "==", currentOwnerId)));
        let loadedPages: Page[] = pagesSnap.docs
          .map((docSnap) => {
            const data = docSnap.data() as Page;
            return {
              ...data,
              id: docSnap.id,
              owner: typeof (data as any).owner === "string" ? (data as any).owner : currentOwnerId,
              version: typeof (data as any).version === "number" ? (data as any).version : 0,
              updatedAt: typeof (data as any).updatedAt === "string" ? (data as any).updatedAt : undefined
            } as Page;
          })
          .filter((page) => page && typeof (page as any).id === "string");

        setPages(loadedPages);
        lastPersistedPagesRef.current = loadedPages;
        const nextActivePageId = loadedPages.find((p) => p.projectId === nextActiveProjectId)?.id ?? loadedPages[0]?.id ?? "";
        setActivePageId(nextActivePageId);
        setDataMessage("Firestore同期済み");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setDataMessage(`Firestore読み込み失敗: ${message}`);
      } finally {
        setIsDataSyncing(false);
      }
    };

    void loadFromFirestore();
  }, [firebaseUser, currentOwnerId, resetToLocalDefaults]);

  // 未ログイン時のみlocalStorageから復元
  useEffect(() => {
    if (firebaseUser || localAccount) return;
    if (typeof window === "undefined") return;
    const raw = window.localStorage.getItem("whiteboard-guest-data");
    if (!raw) {
      resetToLocalDefaults();
      setDataMessage("ゲスト: 初期データを作成しました");
      return;
    }
    try {
      const parsed = JSON.parse(raw) as Partial<LocalPersistedData>;
      const nextProjects = Array.isArray(parsed.projects) && parsed.projects.length > 0 ? parsed.projects : initialProjects;
      const nextPages = Array.isArray(parsed.pages) ? parsed.pages : [];
      setProjects(nextProjects);
      setPages(nextPages);
      lastPersistedProjectsRef.current = nextProjects;
      lastPersistedPagesRef.current = nextPages;
      const nextActiveProjectId =
        parsed.activeProjectId && nextProjects.some((project) => project.id === parsed.activeProjectId)
          ? parsed.activeProjectId
          : nextProjects[0]?.id ?? DEFAULT_PROJECT_ID;
      setActiveProjectId(nextActiveProjectId);
      const nextActivePageId =
        parsed.activePageId &&
        nextPages.some((page) => page.id === parsed.activePageId && page.projectId === nextActiveProjectId)
          ? parsed.activePageId
          : nextPages.find((page) => page.projectId === nextActiveProjectId)?.id ?? "";
      setActivePageId(nextActivePageId);
      setDataMessage("ゲストデータを復元しました");
    } catch (error) {
      console.error("ゲストデータ復元に失敗しました", error);
      resetToLocalDefaults();
      setDataMessage("ゲストデータが壊れていたため初期化しました");
    }
  }, [firebaseUser, localAccount, resetToLocalDefaults]);

  useEffect(() => {
    if (!activeProject) {
      setProjectRenameDraft("");
      return;
    }
    setProjectRenameDraft(activeProject.name);
  }, [activeProject?.name, activeProjectId]);

  // 自動保存を停止（保存ボタンでのみ保存）
  // useEffect(() => {}, [projects, firebaseUser, currentOwnerId]);

  useEffect(() => {
    if (typeof window === "undefined" || !isProjectMenuOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (projectMenuRef.current && !projectMenuRef.current.contains(event.target as Node)) {
        setIsProjectMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", handleClickOutside);
    return () => window.removeEventListener("mousedown", handleClickOutside);
  }, [isProjectMenuOpen]);

  useEffect(() => {
    if (typeof window === "undefined" || !isPageMenuOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (pageMenuRef.current && !pageMenuRef.current.contains(event.target as Node)) {
        setIsPageMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", handleClickOutside);
    return () => window.removeEventListener("mousedown", handleClickOutside);
  }, [isPageMenuOpen]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.setProperty("color-scheme", theme);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    }
  }, [theme]);

  // useEffect(() => {}, [pages, firebaseUser, currentOwnerId]);
  // 保存ボタン用: Firestoreの最新データとローカルの差分を比較し、競合時は選択UIを出す
  const handleManualSave = useCallback(async () => {
    if (!currentOwnerId) {
      setDataMessage("ログインが必要です");
      return;
    }
    setIsDataSyncing(true);
    setDataMessage("保存中...");
    try {
      // Firestoreから最新データ取得
      const projectsSnap = await getDocs(query(collection(db, "projects"), where("owner", "==", currentOwnerId)));
      const remoteProjects = projectsSnap.docs.map((docSnap) => ({ ...docSnap.data(), id: docSnap.id } as Project));
      const pagesSnap = await getDocs(query(collection(db, "pages"), where("owner", "==", currentOwnerId)));
      const remotePages = pagesSnap.docs.map((docSnap) => ({ ...docSnap.data(), id: docSnap.id } as Page));

      // 競合検出: 既存IDでversionが異なるものを検出
      const conflictedProject = projects.find(lp => {
        const remote = remoteProjects.find(rp => rp.id === lp.id);
        return remote && remote.version !== lp.version;
      });
      if (conflictedProject) {
        await handleVersionConflict("project", conflictedProject.id, conflictedProject);
        setIsDataSyncing(false);
        return;
      }
      const conflictedPage = pages.find(lp => {
        const remote = remotePages.find(rp => rp.id === lp.id);
        return remote && remote.version !== lp.version;
      });
      if (conflictedPage) {
        await handleVersionConflict("page", conflictedPage.id, conflictedPage);
        setIsDataSyncing(false);
        return;
      }

      // 競合がなければローカルの編集・新規追加分のみ保存
      const changedProjects = getChangedItems(projects, remoteProjects);
      const changedPages = getChangedItems(pages, remotePages);
      await Promise.all([
        ...changedProjects.map(p => persistProjectWithVersion(p, currentOwnerId)),
        ...changedPages.map(p => persistPageWithVersion(p, currentOwnerId)),
      ]);
      // Firestoreの最新versionでローカルを更新
      const updatedProjectsSnap = await getDocs(query(collection(db, "projects"), where("owner", "==", currentOwnerId)));
      const updatedProjects = updatedProjectsSnap.docs.map((docSnap) => ({ ...docSnap.data(), id: docSnap.id } as Project));
      const updatedPagesSnap = await getDocs(query(collection(db, "pages"), where("owner", "==", currentOwnerId)));
      const updatedPages = updatedPagesSnap.docs.map((docSnap) => ({ ...docSnap.data(), id: docSnap.id } as Page));
      setProjects(updatedProjects);
      setPages(updatedPages);
      setDataMessage("保存しました（編集・新規分のみ反映）");
    } catch (error) {
      setDataMessage("保存に失敗しました");
      console.error(error);
    } finally {
      setIsDataSyncing(false);
    }
  }, [currentOwnerId, projects, pages, handleVersionConflict]);
  // UI: 保存ボタンを追加
  // ...既存のreturn内の適切な場所に以下を追加してください...
  // <button onClick={handleManualSave} disabled={isDataSyncing || !currentOwnerId}>保存</button>

  // 未ログイン時のみlocalStorageへ自動保存
  useEffect(() => {
    if (firebaseUser || localAccount) return;
    if (typeof window === "undefined") return;
    if (localPersistTimerRef.current) {
      window.clearTimeout(localPersistTimerRef.current);
    }
    const changedProjects = getChangedItems(projects, lastPersistedProjectsRef.current);
    const changedPages = getChangedItems(pages, lastPersistedPagesRef.current);
    if (changedProjects.length === 0 && changedPages.length === 0) return;
    localPersistTimerRef.current = window.setTimeout(() => {
      persistLocalData();
      lastPersistedProjectsRef.current = projects;
      lastPersistedPagesRef.current = pages;
    }, 400);
    return () => {
      if (localPersistTimerRef.current) {
        window.clearTimeout(localPersistTimerRef.current);
      }
    };
  }, [projects, pages, activeProjectId, activePageId, firebaseUser, localAccount, persistLocalData]);

  useEffect(() => {
    if (!isPanning) return;
    const handleMouseMove = (event: MouseEvent) => {
      const newX = event.clientX - panStartRef.current.x;
      const newY = event.clientY - panStartRef.current.y;
      setMindmapPan({ x: newX, y: newY });
    };
    const handleMouseUp = () => {
      setIsPanning(false);
    };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isPanning]);

  // 既存データを新構造にアップグレード（sections/connector sideなど）
  useEffect(() => {
    setPages((prev) =>
      prev.map((page) => {
        if (!isMindmapPage(page)) return page;
        let nodesMutated = false;
        let nodes = page.nodes.map((node) => {
          if (node.sections && node.sections.length > 0) {
            return node;
          }
          nodesMutated = true;
          const legacy = (node as MindmapNode & { text?: string }).text ?? "";
          return {
            ...node,
            sections: [createSection(legacy || "新しいアイテム")]
          };
        });
        const nodeMap = new Map(nodes.map((node) => [node.id, node]));
        const ensureSection = (nodeId: string) => {
          const target = nodeMap.get(nodeId);
          if (!target) return { node: undefined, sectionId: "" };
          if (target.sections.length > 0) {
            return { node: target, sectionId: target.sections[0].id };
          }
          const fallback = createSection("新しいアイテム");
          nodesMutated = true;
          const updatedNode: MindmapNode = { ...target, sections: [fallback] };
          nodeMap.set(updatedNode.id, updatedNode);
          nodes = nodes.map((node) => (node.id === updatedNode.id ? updatedNode : node));
          return { node: updatedNode, sectionId: fallback.id };
        };
        let linksMutated = false;
        const links = page.links
          .map((link) => {
            const rawLink = link as MindmapLink & {
              from: MindmapConnector | (MindmapConnector & { side?: "left" | "right" }) | string;
              to: MindmapConnector | (MindmapConnector & { side?: "left" | "right" }) | string;
            };
            const needsUpgrade =
              typeof rawLink.from === "string" ||
              typeof rawLink.to === "string" ||
              (typeof rawLink.from === "object" && !("side" in rawLink.from)) ||
              (typeof rawLink.to === "object" && !("side" in rawLink.to));
            if (!needsUpgrade) {
              return rawLink;
            }
            linksMutated = true;
            const fromNodeId = typeof rawLink.from === "string" ? rawLink.from : rawLink.from.nodeId;
            const toNodeId = typeof rawLink.to === "string" ? rawLink.to : rawLink.to.nodeId;
            if (!fromNodeId || !toNodeId) {
              return null;
            }
            const { sectionId: fromSectionId } = ensureSection(fromNodeId);
            const { sectionId: toSectionId } = ensureSection(toNodeId);
            if (!fromSectionId || !toSectionId) {
              return null;
            }
            const fallbackFromSide =
              typeof rawLink.from === "object" && "side" in rawLink.from ? rawLink.from.side : "right";
            const fallbackToSide =
              typeof rawLink.to === "object" && "side" in rawLink.to ? rawLink.to.side : "left";
            return {
              ...rawLink,
              from:
                typeof rawLink.from === "string"
                  ? { nodeId: fromNodeId, sectionId: fromSectionId, side: "right" }
                  : { ...rawLink.from, side: fallbackFromSide ?? "right" },
              to:
                typeof rawLink.to === "string"
                  ? { nodeId: toNodeId, sectionId: toSectionId, side: "left" }
                  : { ...rawLink.to, side: fallbackToSide ?? "left" }
            } as MindmapLink;
          })
          .filter((link): link is MindmapLink => link !== null);
        if (!nodesMutated && !linksMutated) return page;
        return { ...page, nodes, links };
      })
    );
  }, []);

  useEffect(() => {
    const next = pages.find((page) => page.id === activePageId && page.projectId === activeProjectId);
    if (next && next.boardId === selectedBoardId) {
      return;
    }
    const fallback = pages.find(
      (page) => page.boardId === selectedBoardId && page.projectId === activeProjectId
    );
    setActivePageId(fallback?.id ?? "");
  }, [activeProjectId, selectedBoardId, pages, activePageId]);

  const pagesForBoard = useMemo(
    () =>
      pages.filter((page) => page.boardId === selectedBoardId && page.projectId === activeProjectId),
    [pages, selectedBoardId, activeProjectId]
  );

  const activePage =
    pages.find((page) => page.id === activePageId && page.projectId === activeProjectId) ??
    pagesForBoard[0] ??
    null;

  useEffect(() => {
    if (!isMindmapPage(activePage)) {
      setSelectedNodeId(null);
      return;
    }
    const hasSelection = activePage.nodes.find((node) => node.id === selectedNodeId);
    if (!hasSelection) {
      setSelectedNodeId(activePage.nodes[0]?.id ?? null);
    }
  }, [activePage, selectedNodeId]);

  useEffect(() => {
    if (!isMindmapPage(activePage)) {
      setLinkingFrom(null);
      setLinkingCursor(null);
    }
  }, [activePage]);

  useEffect(() => {
    setIsPageMenuOpen(false);
  }, [selectedBoardId]);

  useEffect(() => {
    if (!isQAPage(activePage)) {
      setSelectedQACardId(null);
      return;
    }
    const exists = activePage.cards.some((card) => card.id === selectedQACardId);
    if (!exists) {
      setSelectedQACardId(activePage.cards[0]?.id ?? null);
    }
  }, [activePage, selectedQACardId]);

  useEffect(() => {
    setQaAnswerDraft("");
  }, [selectedQACardId]);

  useEffect(() => {
    return () => {
      if (projectsPersistTimerRef.current) {
        window.clearTimeout(projectsPersistTimerRef.current);
      }
      if (pagesPersistTimerRef.current) {
        window.clearTimeout(pagesPersistTimerRef.current);
      }
      if (localPersistTimerRef.current) {
        window.clearTimeout(localPersistTimerRef.current);
      }
    };
  }, []);

  const boardCounts = useMemo(() => {
    return boards.reduce<Record<BoardType, number>>(
      (acc, board) => {
        acc[board.id] = pages.filter(
          (page) => page.boardId === board.id && page.projectId === activeProjectId
        ).length;
        return acc;
      },
      { proposal: 0, mindmap: 0, ranking: 0, qa: 0 }
    );
  }, [pages, activeProjectId]);
  useEffect(() => {
    if (editingTextBoxRefRef.current) {
      editingTextBoxRefRef.current.style.height = "auto";
      editingTextBoxRefRef.current.style.height = Math.max(
        32,
        Math.min(300, editingTextBoxRefRef.current.scrollHeight)
      ) + "px";
    }
  }, [editingTextBoxId]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  }, []);

  const handleFirebaseAuthLogin = useCallback(async () => {
    setIsAuthSigningIn(true);
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
      setFirebaseStatus("auth ok: signed in (Google)");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setFirebaseStatus(`auth error: ${message}`);
    } finally {
      setIsAuthSigningIn(false);
    }
  }, []);

  const handleFirebaseCheck = useCallback(async () => {
    setIsCheckingFirebase(true);
    try {
      const projectId = auth.app?.options?.projectId ?? "(unknown)";
      let summary = `auth ok (projectId=${projectId})`;
      try {
        const snap = await getDoc(doc(db, "__health", "ping"));
        summary += snap.exists() ? " / firestore ok (doc found)" : " / firestore ok (doc missing)";
      } catch (firestoreError) {
        const message = firestoreError instanceof Error ? firestoreError.message : String(firestoreError);
        summary += ` / firestore error: ${message}`;
      }
      setFirebaseStatus(summary);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setFirebaseStatus(`error: ${message}`);
    } finally {
      setIsCheckingFirebase(false);
    }
  }, []);

  const handleAccountDialogClose = useCallback(() => {
    setIsAccountModalOpen(false);
    setAccountMessage("");
    setAccountNameInput("");
    setAccountKeyInput("");
  }, []);

  const handleLocalAccountLogin = useCallback(async () => {
    if (isAuthSigningIn) return;
    const name = accountNameInput.trim();
    const key = accountKeyInput.trim();
    if (!name) {
      setAccountMessage("アカウント名を入力してください");
      return;
    }
    setIsAuthSigningIn(true);
    const nextAccount: LocalAccount = { name, key };
    setLocalAccount(nextAccount);
    setActiveAccountId(name);
    setAccountMessage("ローカルアカウントでログインしました");
    setIsAccountModalOpen(false);
    // Firestore初期化（データ取得 or 新規作成）
    // リロードせず、localAccountのセットだけで状態遷移を進める
    setIsAuthSigningIn(false);
  }, [isAuthSigningIn, accountNameInput, accountKeyInput]);

  const handleAccountLogout = useCallback(() => {
    if (firebaseUser) {
      signOut(auth).finally(() => {
        resetToLocalDefaults();
        setIsAccountModalOpen(false);
        setPendingConflict(null);
      });
      return;
    }
    // ログアウト時は未保存編集をFirestoreに保存しない（ローカルのみ保存）
    setLocalAccount(null);
    setActiveAccountId(null);
    setAccountMessage("ログアウトしました");
    resetToLocalDefaults();
    setIsAccountModalOpen(false);
    setPendingConflict(null);
  }, [firebaseUser, persistLocalData, resetToLocalDefaults]);

  const handleGoogleLogin = useCallback(async () => {
    if (isAuthSigningIn) return;
    setIsAuthSigningIn(true);
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
      setAccountMessage("Googleでログインしました");
      setIsAccountModalOpen(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setAccountMessage(`Googleログインに失敗しました: ${message}`);
    } finally {
      setIsAuthSigningIn(false);
    }
  }, [isAuthSigningIn]);

  const adjustMindmapScale = useCallback((delta: number) => {
    setMindmapScale((prev) => {
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, prev + delta));
      return Number(next.toFixed(2));
    });
  }, []);

  const handleZoomIn = useCallback(() => adjustMindmapScale(ZOOM_STEP), [adjustMindmapScale]);
  const handleZoomOut = useCallback(() => adjustMindmapScale(-ZOOM_STEP), [adjustMindmapScale]);
  const handleZoomReset = useCallback(() => setMindmapScale(1), []);
  const handleFocusNode = useCallback(() => {
    if (!selectedNodeId || !isMindmapPage(activePage)) return;
    const node = activePage.nodes.find((n) => n.id === selectedNodeId);
    if (!node) return;
    const containerRect = mindmapContainerRef.current?.getBoundingClientRect();
    if (!containerRect) return;
    const containerWidth = containerRect.width;
    const containerHeight = containerRect.height;
    const nodeCenterX = node.x + NODE_WIDTH / 2;
    const nodeCenterY = node.y + 50;
    const zoomLevel = 0.8;
    setMindmapScale(zoomLevel);
    const offsetX = containerWidth / 2 - nodeCenterX * zoomLevel;
    const offsetY = containerHeight / 2 - nodeCenterY * zoomLevel;
    setMindmapPan({ x: offsetX, y: offsetY });
  }, [selectedNodeId, activePage]);

  const handleFitAllNodes = useCallback(() => {
    if (!isMindmapPage(activePage) || activePage.nodes.length === 0) return;
    const containerRect = mindmapContainerRef.current?.getBoundingClientRect();
    if (!containerRect) return;
    const containerWidth = containerRect.width;
    const containerHeight = containerRect.height;
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    activePage.nodes.forEach((node) => {
      minX = Math.min(minX, node.x);
      minY = Math.min(minY, node.y);
      maxX = Math.max(maxX, node.x + NODE_WIDTH);
      maxY = Math.max(maxY, node.y + 100);
    });
    const contentWidth = maxX - minX;
    const contentHeight = maxY - minY;
    const padding = 1.2;
    const scaleX = containerWidth / (contentWidth * padding);
    const scaleY = containerHeight / (contentHeight * padding);
    const newZoom = Math.min(scaleX, scaleY, MAX_ZOOM);
    setMindmapScale(newZoom);
    const contentCenterX = (minX + maxX) / 2;
    const contentCenterY = (minY + maxY) / 2;
    const offsetX = containerWidth / 2 - contentCenterX * newZoom;
    const offsetY = containerHeight / 2 - contentCenterY * newZoom;
    setMindmapPan({ x: offsetX, y: offsetY });
  }, [activePage]);

  const handleMindmapWheel = useCallback(
    (event: ReactWheelEvent<HTMLDivElement>) => {
      event.preventDefault();
      adjustMindmapScale(event.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP);
    },
    [adjustMindmapScale]
  );

  const resolveConflictWithRemote = useCallback(() => {
    if (!pendingConflict) return;
    if (pendingConflict.kind === "project") {
      const remote = pendingConflict.remote as Project;
      setProjects((prev) => prev.map((p) => (p.id === remote.id ? remote : p)));
      lastPersistedProjectsRef.current = lastPersistedProjectsRef.current.map((p) => (p.id === remote.id ? remote : p));
    } else {
      const remote = pendingConflict.remote as Page;
      const local = pendingConflict.local as Page;
      if (isLargeDifference(local, remote)) {
        // 新規ページとして追加
        const remotePage = remote as Page;
        const newId = remotePage.id + "_copy_" + Date.now();
        const newPage = { ...remotePage, id: newId, title: (remotePage.title || "") + " (コピー)" };
        setPages((prev) => [...prev, newPage]);
        lastPersistedPagesRef.current = [...lastPersistedPagesRef.current, newPage];
      } else {
        setPages((prev) => prev.map((p) => (p.id === remote.id ? remote : p)));
        lastPersistedPagesRef.current = lastPersistedPagesRef.current.map((p) => (p.id === remote.id ? remote : p));
      }
    }
    setPendingConflict(null);
    setDataMessage("リモートの内容を採用しました");
  }, [pendingConflict]);

  // 両方マージして保存
  const resolveConflictWithMerge = useCallback(async () => {
    if (!pendingConflict || !currentOwnerId) return;
    const { kind, local, remote } = pendingConflict;
    // 企画書（proposal）やダイアログ（qa）は両方マージ時、ローカル・リモート両方を新規ページとして保存
    if (kind === "page" && ((local as any).boardId === "proposal" || (local as any).boardId === "qa")) {
      const localPage = local as Page;
      const remotePage = remote as Page;
      const now = Date.now();
      const newIdLocal = localPage.id + "_merge_local_" + now;
      const newIdRemote = remotePage.id + "_merge_remote_" + now;
      const newPageLocal = { ...localPage, id: newIdLocal, title: (localPage.title || "") + " (マージ:自分)" };
      const newPageRemote = { ...remotePage, id: newIdRemote, title: (remotePage.title || "") + " (マージ:他)" };
      await persistPageWithVersion(newPageLocal, currentOwnerId);
      await persistPageWithVersion(newPageRemote, currentOwnerId);
      setPages((prev) => [...prev, newPageLocal, newPageRemote]);
      setPendingConflict(null);
      setDataMessage("両方の内容を別ページとして保存しました");
      return;
    }
    let merged: any = {};
    if (kind === "project") {
      merged = { ...remote, ...local };
    } else if (kind === "page") {
      const base = { ...remote, ...local };
      if ((base as any).boardId === "qa") {
        const localCards = (local as any).cards || [];
        const remoteCards = (remote as any).cards || [];
        const localIds = localCards.map((c: any) => c.id);
        const remoteOnly = remoteCards.filter((c: any) => !localIds.includes(c.id));
        const mergedCards = [...localCards, ...remoteOnly];
        mergedCards.forEach((card: any, idx: number) => {
          const localCard = localCards.find((c: any) => c.id === card.id);
          const remoteCard = remoteCards.find((c: any) => c.id === card.id);
          if (localCard && remoteCard) {
            const localAnsIds = (localCard.answers || []).map((a: any) => a.id);
            const remoteAnsOnly = (remoteCard.answers || []).filter((a: any) => !localAnsIds.includes(a.id));
            mergedCards[idx].answers = [...(localCard.answers || []), ...remoteAnsOnly];
          }
        });
        (base as any).cards = mergedCards;
      }
      if ((base as any).boardId === "ranking") {
        const localItems = (local as any).items || [];
        const remoteItems = (remote as any).items || [];
        const localIds = localItems.map((i: any) => i.id);
        const remoteOnly = remoteItems.filter((i: any) => !localIds.includes(i.id));
        (base as any).items = [...localItems, ...remoteOnly];
      }
      if ((base as any).boardId === "mindmap") {
        const localNodes = (local as any).nodes || [];
        const remoteNodes = (remote as any).nodes || [];
        const localNodeIds = localNodes.map((n: any) => n.id);
        const remoteNodeOnly = remoteNodes.filter((n: any) => !localNodeIds.includes(n.id));
        (base as any).nodes = [...localNodes, ...remoteNodeOnly];
        const localTextBoxes = (local as any).textBoxes || [];
        const remoteTextBoxes = (remote as any).textBoxes || [];
        const localTbIds = localTextBoxes.map((tb: any) => tb.id);
        const remoteTbOnly = remoteTextBoxes.filter((tb: any) => !localTbIds.includes(tb.id));
        (base as any).textBoxes = [...localTextBoxes, ...remoteTbOnly];
      }
      merged = base;
    }
    merged.version = (remote as any).version;
    merged.updatedAt = nowIso();
    try {
      let saved: Project | Page | null = null;
      if (kind === "project") {
        await persistProjectWithVersion(merged, currentOwnerId);
        saved = await fetchRemoteProject(merged.id);
        setProjects((prev) => prev.map((p) => p.id === merged.id && saved && "name" in saved ? saved as Project : p));
      } else {
        await persistPageWithVersion(merged, currentOwnerId);
        saved = await fetchRemotePage(merged.id);
        setPages((prev) => prev.map((p) => p.id === merged.id && saved && "title" in saved ? saved as Page : p));
      }
      setPendingConflict(null);
      setDataMessage("両方の内容をマージして保存しました");
    } catch (error) {
      setDataMessage("マージ保存に失敗しました");
      console.error(error);
    }
  }, [pendingConflict, currentOwnerId]);

  const resolveConflictWithLocal = useCallback(async () => {
    if (!pendingConflict || !currentOwnerId) return;
    try {
      let saved: Project | Page | null = null;
      if (pendingConflict.kind === "project") {
        const local = pendingConflict.local as Project;
        const remote = await fetchRemoteProject(local.id);
        const remoteVersion = remote && typeof remote.version === "number" ? remote.version : 0;
        const next = { ...local, version: remoteVersion, updatedAt: nowIso() };
        await persistProjectWithVersion(next, currentOwnerId);
        saved = await fetchRemoteProject(local.id);
        setProjects((prev) => prev.map((p) => p.id === local.id && saved && "name" in saved ? saved as Project : p));
      } else {
        const local = pendingConflict.local as Page;
        const remote = await fetchRemotePage(local.id);
        const remoteVersion = remote && typeof remote.version === "number" ? remote.version : 0;
        if (isLargeDifference(local, remote)) {
          // 新規ページとして追加
          const localPage = local as Page;
          const newId = localPage.id + "_copy_" + Date.now();
          const newPage = { ...localPage, id: newId, title: (localPage.title || "") + " (コピー)" };
          await persistPageWithVersion(newPage, currentOwnerId);
          setPages((prev) => [...prev, newPage]);
        } else {
          const next = { ...local, version: remoteVersion, updatedAt: nowIso() } as Page;
          await persistPageWithVersion(next, currentOwnerId);
          saved = await fetchRemotePage(local.id);
          setPages((prev) => prev.map((p) => p.id === local.id && saved && "title" in saved ? saved as Page : p));
        }
      }
      setPendingConflict(null);
      setDataMessage("ローカルの内容で上書きしました");
    } catch (error) {
      console.error("競合解決に失敗", error);
      setDataMessage("競合解決に失敗しました");
    }
  }, [pendingConflict, firebaseUser, currentOwnerId]);

  const handleMindmapMouseDown = useCallback(
    (event: React.MouseEvent) => {
      if (event.button !== 1) return;
      event.preventDefault();
      setIsPanning(true);
      setSelectedSectionId(null);
      panStartRef.current = { x: event.clientX - mindmapPan.x, y: event.clientY - mindmapPan.y };
    },
    [mindmapPan]
  );

  const handleProjectSelect = useCallback((projectId: string) => {
    setActiveProjectId(projectId);
    setIsProjectMenuOpen(false);
  }, []);

  const handleAddProject = useCallback(() => {
    const trimmedName = newProjectName.trim();
    if (!trimmedName) return;
    const newProject: Project = {
      id: createId("project"),
      name: trimmedName,
      owner: currentOwnerId ?? undefined,
      version: 0,
      updatedAt: nowIso()
    };
    setProjects((prev) => [...prev, newProject]);
    const defaults = createDefaultPagesForProject(newProject.id).map((page) => ({ ...page, owner: currentOwnerId ?? page.owner }));
    setPages((prev) => [...prev, ...defaults]);
    setActiveProjectId(newProject.id);
    setNewProjectName("");
  }, [newProjectName, currentOwnerId]);

  const handleRenameProject = useCallback(() => {
    if (!activeProject) return;
    const trimmedName = projectRenameDraft.trim();
    if (!trimmedName || trimmedName === activeProject.name) return;
    setProjects((prev) =>
      prev.map((project) =>
        project.id === activeProjectId ? { ...project, name: trimmedName } : project
      )
    );
  }, [activeProject, activeProjectId, projectRenameDraft]);

  const handleBoardSelect = useCallback((boardId: BoardType) => {
    setSelectedBoardId(boardId);
  }, []);

  const handlePageSelect = useCallback((pageId: string) => {
    setActivePageId(pageId);
  }, []);

  const handleAddPage = useCallback(() => {
    const basePage =
      selectedBoardId === "proposal"
        ? createMarkdownPage("New Proposal", activeProjectId)
        : selectedBoardId === "qa"
        ? createQAPage("New Q&A", activeProjectId)
        : selectedBoardId === "mindmap"
        ? createMindmapPage("New Mindmap", activeProjectId)
        : createRankingPage("New Ranking", activeProjectId);
    const page = { ...basePage, owner: currentOwnerId ?? basePage.owner } as Page;
    setPages((prev) => [...prev, page]);
    setActivePageId(page.id);
  }, [selectedBoardId, activeProjectId, currentOwnerId]);


  const handleAddQACard = useCallback(() => {
    const newCard = createQACard();
    setPages((prev) =>
      prev.map((page) =>
        isQAPage(page) && page.id === activePageId
          ? { ...page, cards: [...page.cards, newCard] }
          : page
      )
    );
    setSelectedQACardId(newCard.id);
  }, [activePageId]);

  const handleQACardFieldChange = useCallback(
    (cardId: string, field: "title" | "description", value: string) => {
      setPages((prev) =>
        prev.map((page) =>
          isQAPage(page) && page.id === activePageId
            ? {
                ...page,
                cards: page.cards.map((card) =>
                  card.id === cardId ? { ...card, [field]: value } : card
                )
              }
            : page
        )
      );
    },
    [activePageId]
  );

  const handleAddQAAnswer = useCallback(() => {
    if (!qaAnswerDraft.trim() || !selectedQACardId) return;
    const nextAnswer = createQAAnswer(qaAnswerDraft.trim());
    setPages((prev) =>
      prev.map((page) =>
        isQAPage(page) && page.id === activePageId
          ? {
              ...page,
              cards: page.cards.map((card) =>
                card.id === selectedQACardId
                  ? { ...card, answers: [...card.answers, nextAnswer] }
                  : card
              )
            }
          : page
      )
    );
    setQaAnswerDraft("");
  }, [activePageId, qaAnswerDraft, selectedQACardId]);

  const handleDeleteQAAnswer = useCallback(
    (cardId: string, answerId: string) => {
      setPages((prev) =>
        prev.map((page) =>
          isQAPage(page) && page.id === activePageId
            ? {
                ...page,
                cards: page.cards.map((card) =>
                  card.id === cardId
                    ? { ...card, answers: card.answers.filter((ans) => ans.id !== answerId) }
                    : card
                )
              }
            : page
        )
      );
    },
    [activePageId]
  );

  const handleDeletePage = useCallback(
    (pageId: string) => {
      setPages((prev) => {
        const next = prev.filter((page) => page.id !== pageId);
        if (pageId === activePageId) {
          const fallback = next.find((page) => page.boardId === selectedBoardId) ?? next[0] ?? null;
          setActivePageId(fallback?.id ?? "");
        }
        return next;
      });
      if (currentOwnerId) {
        deleteDoc(doc(db, "pages", pageId)).catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          setDataMessage(`ページ削除失敗: ${message}`);
        });
      }
    },
    [activePageId, selectedBoardId, currentOwnerId]
  );

  const handleTitleChange = useCallback(
    (value: string) => {
      setPages((prev) => prev.map((page) => (page.id === activePageId ? { ...page, title: value } : page)));
    },
    [activePageId]
  );

  const handleMarkdownChange = useCallback(
    (value: string) => {
      setPages((prev) =>
        prev.map((page) => (page.id === activePageId && isMarkdownPage(page) ? { ...page, content: value } : page))
      );
    },
    [activePageId]
  );

  const handleRankingNoteChange = useCallback(
    (value: string) => {
      setPages((prev) =>
        prev.map((page) => (isRankingPage(page) && page.id === activePageId ? { ...page, note: value } : page))
      );
    },
    [activePageId]
  );

  const handleRankingItemTitleChange = useCallback(
    (itemId: string, value: string) => {
      setPages((prev) =>
        prev.map((page) =>
          isRankingPage(page) && page.id === activePageId
            ? {
                ...page,
                items: page.items.map((item) => (item.id === itemId ? { ...item, title: value } : item))
              }
            : page
        )
      );
    },
    [activePageId]
  );

  const handleRankingItemBodyChange = useCallback(
    (itemId: string, value: string) => {
      setPages((prev) =>
        prev.map((page) =>
          isRankingPage(page) && page.id === activePageId
            ? {
                ...page,
                items: page.items.map((item) => (item.id === itemId ? { ...item, body: value } : item))
              }
            : page
        )
      );
    },
    [activePageId]
  );

  const handleRankingAddItem = useCallback(() => {
    const nextItem = createRankingItem("", "");
    setPages((prev) =>
      prev.map((page) =>
        isRankingPage(page) && page.id === activePageId ? { ...page, items: [nextItem, ...page.items] } : page
      )
    );
  }, [activePageId]);

  const handleRankingDeleteItem = useCallback(
    (itemId: string) => {
      setPages((prev) =>
        prev.map((page) =>
          isRankingPage(page) && page.id === activePageId
            ? { ...page, items: page.items.filter((item) => item.id !== itemId) }
            : page
        )
      );
    },
    [activePageId]
  );

  const handleRankingMoveItem = useCallback(
    (itemId: string, direction: "up" | "down") => {
      setPages((prev) =>
        prev.map((page) => {
          if (!isRankingPage(page) || page.id !== activePageId) return page;
          const index = page.items.findIndex((item) => item.id === itemId);
          if (index === -1) return page;
          const nextIndex = direction === "up" ? Math.max(0, index - 1) : Math.min(page.items.length - 1, index + 1);
          if (index === nextIndex) return page;
          const nextItems = [...page.items];
          const [moved] = nextItems.splice(index, 1);
          nextItems.splice(nextIndex, 0, moved);
          return { ...page, items: nextItems };
        })
      );
    },
    [activePageId]
  );

  const handleRankingDragStart = useCallback((itemId: string, event: React.DragEvent) => {
    setDraggingRankingItemId(itemId);
    event.dataTransfer.effectAllowed = "move";
  }, []);

  const handleRankingDragOver = useCallback((targetId: string, event: React.DragEvent) => {
    event.preventDefault();
    setDragOverRankingItemId(targetId);
    event.dataTransfer.dropEffect = "move";
  }, []);

  const handleRankingDrop = useCallback((targetId: string) => {
    if (!draggingRankingItemId || draggingRankingItemId === targetId) {
      setDraggingRankingItemId(null);
      setDragOverRankingItemId(null);
      return;
    }
    setPages((prev) =>
      prev.map((page) => {
        if (!isRankingPage(page) || page.id !== activePageId) return page;
        const fromIndex = page.items.findIndex((i) => i.id === draggingRankingItemId);
        const toIndex = page.items.findIndex((i) => i.id === targetId);
        if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return page;
        const nextItems = [...page.items];
        const [moved] = nextItems.splice(fromIndex, 1);
        nextItems.splice(toIndex, 0, moved);
        return { ...page, items: nextItems };
      })
    );
    setDraggingRankingItemId(null);
    setDragOverRankingItemId(null);
  }, [activePageId, draggingRankingItemId]);

  const handleDownloadMarkdown = useCallback(() => {
    if (!isMarkdownPage(activePage)) return;
    const blob = new Blob([activePage.content], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${activePage.title || "idea-note"}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [activePage]);

  const handleOpenPreview = useCallback(() => {
    if (!isMarkdownPage(activePage)) return;
    (savePreviewPayload as any)({ title: activePage.title, content: activePage.content });
    if (typeof window !== "undefined") {
      window.open("/preview", "_blank", "noopener,noreferrer");
    }
  }, [activePage]);

  const handleSelectedNodeTitleChange = useCallback(
    (value: string) => {
      if (!selectedNodeId) return;
      setPages((prev) =>
        prev.map((page) =>
          isMindmapPage(page) && page.id === activePageId
            ? {
                ...page,
                nodes: page.nodes.map((node) => (node.id === selectedNodeId ? { ...node, title: value } : node))
              }
            : page
        )
      );
    },
    [selectedNodeId, activePageId]
  );
  const handleSelectedNodeColorChange = useCallback(
    (value: string) => {
      if (!selectedNodeId) return;
      setPages((prev) =>
        prev.map((page) =>
          isMindmapPage(page) && page.id === activePageId
            ? {
                ...page,
                nodes: page.nodes.map((node) => (node.id === selectedNodeId ? { ...node, color: value } : node))
              }
            : page
        )
      );
    },
    [selectedNodeId, activePageId]
  );

  const handleSelectedNodeValueChange = useCallback(
    (value: number) => {
      if (!selectedNodeId) return;
      const clampedValue = Math.max(1, Math.min(100, value));
      setPages((prev) =>
        prev.map((page) =>
          isMindmapPage(page) && page.id === activePageId
            ? {
                ...page,
                nodes: page.nodes.map((node) => (node.id === selectedNodeId ? { ...node, value: clampedValue } : node))
              }
            : page
        )
      );
    },
    [selectedNodeId, activePageId]
  );

  const handleSectionTextChange = useCallback(
    (nodeId: string, sectionId: string, value: string) => {
      setPages((prev) =>
        prev.map((page) =>
          isMindmapPage(page) && page.id === activePageId
            ? {
                ...page,
                nodes: page.nodes.map((node) =>
                  node.id === nodeId
                    ? {
                        ...node,
                        sections: node.sections.map((section) =>
                          section.id === sectionId ? { ...section, text: value } : section
                        )
                      }
                    : node
                )
              }
            : page
        )
      );
    },
    [activePageId]
  );

  const handleSectionFontSizeChange = useCallback(
    (nodeId: string, sectionId: string, fontSize: number) => {
      setPages((prev) =>
        prev.map((page) =>
          isMindmapPage(page) && page.id === activePageId
            ? {
                ...page,
                nodes: page.nodes.map((node) =>
                  node.id === nodeId
                    ? {
                        ...node,
                        sections: node.sections.map((section) =>
                          section.id === sectionId ? { ...section, fontSize } : section
                        )
                      }
                    : node
                )
              }
            : page
        )
      );
    },
    [activePageId]
  );

  const handleTextBoxFontSizeChange = useCallback(
    (textBoxId: string, fontSize: number) => {
      setPages((prev) =>
        prev.map((page) =>
          isMindmapPage(page) && page.id === activePageId
            ? {
                ...page,
                textBoxes: (page.textBoxes || []).map((tb) =>
                  tb.id === textBoxId ? { ...tb, fontSize } : tb
                )
              }
            : page
        )
      );
    },
    [activePageId]
  );

  const handleAddSection = useCallback(
    (nodeId: string) => {
      setPages((prev) =>
        prev.map((page) =>
          isMindmapPage(page) && page.id === activePageId
            ? {
                ...page,
                nodes: page.nodes.map((node) =>
                  node.id === nodeId ? { ...node, sections: [...node.sections, createSection("新しいアイテム")] } : node
                )
              }
            : page
        )
      );
    },
    [activePageId]
  );

  const handleDeleteSection = useCallback(
    (nodeId: string, sectionId: string) => {
      setPages((prev) =>
        prev.map((page) =>
          isMindmapPage(page) && page.id === activePageId
            ? {
                ...page,
                nodes: page.nodes.map((node) =>
                  node.id === nodeId
                    ? {
                        ...node,
                        sections: node.sections.filter((section) => section.id !== sectionId)
                      }
                    : node
                ),
                links: page.links.filter(
                  (link) =>
                    !(link.from.nodeId === nodeId && link.from.sectionId === sectionId) &&
                    !(link.to.nodeId === nodeId && link.to.sectionId === sectionId)
                )
              }
            : page
        )
      );
    },
    [activePageId]
  );

  const handleMindmapAddNode = useCallback(() => {
    if (!isMindmapPage(activePage)) return;
    const newNode: MindmapNode = {
      id: createId("node"),
      title: DEFAULT_NODE_TITLE,
      color: DEFAULT_NODE_COLOR,
      value: 10,
      x: 280 + Math.random() * 120,
      y: 260 + Math.random() * 120,
      sections: [createSection("新しいアイテム")]
    };
    setPages((prev) =>
      prev.map((page) =>
        isMindmapPage(page) && page.id === activePage.id
          ? { ...page, nodes: [...page.nodes, newNode] }
          : page
      )
    );
    setSelectedNodeId(newNode.id);
  }, [activePage]);

  const handleMindmapAddTextBox = useCallback(() => {
    if (!isMindmapPage(activePage)) return;
    const newTextBox: MindmapTextBox = {
      id: createId("textbox"),
      text: "",
      color: DEFAULT_NODE_COLOR,
      value: 10,
      x: 280 + Math.random() * 120,
      y: 260 + Math.random() * 120
    };
    setPages((prev) =>
      prev.map((page) =>
        isMindmapPage(page) && page.id === activePage.id
          ? { ...page, textBoxes: [...(page.textBoxes || []), newTextBox] }
          : page
      )
    );
    setSelectedTextBoxId(newTextBox.id);
    setEditingTextBoxId(newTextBox.id);
  }, [activePage]);

  const handleDeleteTextBox = useCallback(() => {
    if (!selectedTextBoxId || !isMindmapPage(activePage)) return;
    setPages((prev) =>
      prev.map((page) =>
        isMindmapPage(page) && page.id === activePage.id
          ? {
              ...page,
              textBoxes: page.textBoxes?.filter((tb) => tb.id !== selectedTextBoxId) || [],
              links: page.links.filter(
                (link) =>
                  link.from.textBoxId !== selectedTextBoxId &&
                  link.to.textBoxId !== selectedTextBoxId
              )
            }
          : page
      )
    );
    setSelectedTextBoxId(null);
  }, [selectedTextBoxId, activePage]);

  const handleSelectedTextBoxTextChange = useCallback(
    (text: string) => {
      if (!editingTextBoxId || !isMindmapPage(activePage)) return;
      setPages((prev) =>
        prev.map((page) =>
          isMindmapPage(page) && page.id === activePage.id
            ? {
                ...page,
                textBoxes: page.textBoxes?.map((tb) =>
                  tb.id === editingTextBoxId ? { ...tb, text } : tb
                ) || []
              }
            : page
        )
      );
    },
    [editingTextBoxId, activePage]
  );

  const handleSelectedTextBoxColorChange = useCallback(
    (color: string) => {
      if (!selectedTextBoxId || !isMindmapPage(activePage)) return;
      setPages((prev) =>
        prev.map((page) =>
          isMindmapPage(page) && page.id === activePage.id
            ? {
                ...page,
                textBoxes: page.textBoxes?.map((tb) =>
                  tb.id === selectedTextBoxId ? { ...tb, color } : tb
                ) || []
              }
            : page
        )
      );
    },
    [selectedTextBoxId, activePage]
  );

  const handleSelectedTextBoxValueChange = useCallback(
    (value: number) => {
      if (!selectedTextBoxId || !isMindmapPage(activePage)) return;
      const clampedValue = Math.max(1, Math.min(100, value));
      setPages((prev) =>
        prev.map((page) =>
          isMindmapPage(page) && page.id === activePage.id
            ? {
                ...page,
                textBoxes: page.textBoxes?.map((tb) =>
                  tb.id === selectedTextBoxId ? { ...tb, value: clampedValue } : tb
                ) || []
              }
            : page
        )
      );
    },
    [selectedTextBoxId, activePage]
  );

  const handleDeleteNode = useCallback(() => {
    if (!selectedNodeId || !isMindmapPage(activePage)) return;
    setPages((prev) =>
      prev.map((page) =>
        isMindmapPage(page) && page.id === activePage.id
          ? {
              ...page,
              nodes: page.nodes.filter((node) => node.id !== selectedNodeId),
              links: page.links.filter(
                (link) =>
                  link.from.nodeId !== selectedNodeId &&
                  link.to.nodeId !== selectedNodeId
              )
            }
          : page
      )
    );
    setSelectedNodeId(null);
  }, [selectedNodeId, activePage]);

  const handleNodeDragStart = useCallback(
    (event: ReactMouseEvent, node: MindmapNode) => {
      if (!isMindmapPage(activePage)) return;
      const rect = mindmapCanvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      event.preventDefault();
      const relativeX = (event.clientX - rect.left) / mindmapScale;
      const relativeY = (event.clientY - rect.top) / mindmapScale;
      setDragging({
        pageId: activePage.id,
        nodeId: node.id,
        offsetX: relativeX - node.x,
        offsetY: relativeY - node.y
      });
    },
    [activePage, mindmapScale]
  );

  const handleTextBoxDragStart = useCallback(
    (event: ReactMouseEvent, textBox: MindmapTextBox) => {
      if (!isMindmapPage(activePage)) return;
      const rect = mindmapCanvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      event.preventDefault();
      const relativeX = (event.clientX - rect.left) / mindmapScale;
      const relativeY = (event.clientY - rect.top) / mindmapScale;
      setDragging({
        pageId: activePage.id,
        textBoxId: textBox.id,
        offsetX: relativeX - textBox.x,
        offsetY: relativeY - textBox.y
      });
    },
    [activePage, mindmapScale]
  );

  useEffect(() => {
    const handleMove = (event: MouseEvent) => {
      if (!dragging) return;
      setPages((prev) =>
        prev.map((page) => {
          if (!isMindmapPage(page) || page.id !== dragging.pageId) return page;
          const rect = mindmapCanvasRef.current?.getBoundingClientRect();
          if (!rect) return page;
          const relativeX = (event.clientX - rect.left) / mindmapScale;
          const relativeY = (event.clientY - rect.top) / mindmapScale;
          const nextX = relativeX - dragging.offsetX;
          const nextY = relativeY - dragging.offsetY;
          
          if (dragging.nodeId) {
            return {
              ...page,
              nodes: page.nodes.map((node) => (node.id === dragging.nodeId ? { ...node, x: nextX, y: nextY } : node))
            };
          } else if (dragging.textBoxId) {
            return {
              ...page,
              textBoxes: (page.textBoxes || []).map((tb) => (tb.id === dragging.textBoxId ? { ...tb, x: nextX, y: nextY } : tb))
            };
          }
          return page;
        })
      );
    };
    const handleUp = () => setDragging(null);
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [dragging, mindmapScale]);

  useEffect(() => {
    if (!linkingFrom) return;
    const handleMove = (event: MouseEvent) => {
        const rect = mindmapCanvasRef.current?.getBoundingClientRect();
        if (!rect) return;
        const relativeX = (event.clientX - rect.left) / mindmapScale;
        const relativeY = (event.clientY - rect.top) / mindmapScale;
        setLinkingCursor({ x: relativeX, y: relativeY });
      };
    const handleUp = () => {
        setLinkingFrom(null);
        setLinkingCursor(null);
      };
      window.addEventListener("mousemove", handleMove);
      window.addEventListener("mouseup", handleUp);
      return () => {
        window.removeEventListener("mousemove", handleMove);
        window.removeEventListener("mouseup", handleUp);
      };
  }, [linkingFrom, mindmapScale]);

  const handleConnectorDrop = useCallback(
      (target: MindmapConnector) => {
        if (!isMindmapPage(activePage) || !linkingFrom) return;
        
        // バリデーション：メモ同士の接続は禁止
        const fromIsTextBox = !!linkingFrom.textBoxId;
        const toIsTextBox = !!target.textBoxId;
        if (fromIsTextBox && toIsTextBox) {
          setLinkingFrom(null);
          setLinkingCursor(null);
          return;
        }
        
        // バリデーション：メモはパネルとしか接続できない
        if (fromIsTextBox && !toIsTextBox) {
          // OKメモ→パネル
        } else if (!fromIsTextBox && toIsTextBox) {
          // OKパネル→メモ
        } else if (!fromIsTextBox && !toIsTextBox) {
          // OKパネル→パネル
        }
        
        if (
          linkingFrom.nodeId === target.nodeId &&
          linkingFrom.textBoxId === target.textBoxId &&
          linkingFrom.sectionId === target.sectionId &&
          linkingFrom.side === target.side
        ) {
          setLinkingFrom(null);
          setLinkingCursor(null);
          return;
        }
        const fromKey = linkingFrom.textBoxId ? `tb:${linkingFrom.textBoxId}:${linkingFrom.side}` : `node:${linkingFrom.nodeId}:${linkingFrom.sectionId}:${linkingFrom.side}`;
        const toKey = target.textBoxId ? `tb:${target.textBoxId}:${target.side}` : `node:${target.nodeId}:${target.sectionId}:${target.side}`;
        const exists = activePage.links.some(
          (link) => {
            const linkFromKey = link.from.textBoxId ? `tb:${link.from.textBoxId}:${link.from.side}` : `node:${link.from.nodeId}:${link.from.sectionId}:${link.from.side}`;
            const linkToKey = link.to.textBoxId ? `tb:${link.to.textBoxId}:${link.to.side}` : `node:${link.to.nodeId}:${link.to.sectionId}:${link.to.side}`;
            return (linkFromKey === fromKey && linkToKey === toKey) || (linkFromKey === toKey && linkToKey === fromKey);
          }
        );
        if (exists) {
          setLinkingFrom(null);
          setLinkingCursor(null);
          return;
        }
        const newLink: MindmapLink = { id: createId("link"), from: linkingFrom, to: target };
        setPages((prev) =>
          prev.map((page) => {
            if (!isMindmapPage(page) || page.id !== activePage.id) return page;
            
            // 新しいリンクを追加したページの状態
            const pageWithNewLink = { ...page, links: [...page.links, newLink] };
            
            // メモの値を接続パネルの平均値に更新
            const updatedTextBoxes = (pageWithNewLink.textBoxes || []).map((tb) => {
              // 更新対象のメモを特定
              const targetTextBoxId = fromIsTextBox ? linkingFrom.textBoxId : toIsTextBox ? target.textBoxId : null;
              if (!targetTextBoxId || tb.id !== targetTextBoxId) return tb;
              
              // このメモに接続されているすべてのパネルを取得
              const connectedNodeIds = new Set<string>();
              pageWithNewLink.links.forEach((link) => {
                if (link.from.textBoxId === targetTextBoxId && link.to.nodeId) {
                  connectedNodeIds.add(link.to.nodeId);
                }
                if (link.to.textBoxId === targetTextBoxId && link.from.nodeId) {
                  connectedNodeIds.add(link.from.nodeId);
                }
              });
              
              // 接続されたパネルの平均値を計算
              if (connectedNodeIds.size > 0) {
                const connectedNodes = Array.from(connectedNodeIds)
                  .map((nodeId) => pageWithNewLink.nodes.find((n) => n.id === nodeId))
                  .filter((n) => n !== undefined) as MindmapNode[];
                if (connectedNodes.length > 0) {
                  const avgValue = Math.round(
                    connectedNodes.reduce((sum, n) => sum + n.value, 0) / connectedNodes.length
                  );
                  return { ...tb, value: Math.max(1, avgValue) };
                }
              }
              return tb;
            });
            
            return { ...pageWithNewLink, textBoxes: updatedTextBoxes };
          })
        );
        setLinkingFrom(null);
        setLinkingCursor(null);
      },
      [isMindmapPage, activePage, linkingFrom]
    );

  const handleConnectorMouseDown = useCallback(
      (event: ReactMouseEvent, connector: MindmapConnector) => {
        if (event.button !== 0) return;
        if (!isMindmapPage(activePage)) return;
        event.preventDefault();
        event.stopPropagation();
        
        // テキストボックスの場合
        if (connector.textBoxId) {
          const textBox = activePage.textBoxes?.find((tb) => tb.id === connector.textBoxId);
          if (!textBox) return;
          setSelectedTextBoxId(connector.textBoxId);
          setLinkingFrom(connector);
          setLinkingCursor({ x: textBox.x, y: textBox.y });
          return;
        }
        
        // ノード（パネル）の場合
        if (!connector.nodeId || !connector.sectionId) return;
        const node = activePage.nodes.find((candidate) => candidate.id === connector.nodeId);
        if (!node) return;
        const section = node.sections.find((s) => s.id === connector.sectionId);
        if (!section) return;
        const anchor = getSectionAnchorPosition(node, section, connector.side);
        setSelectedNodeId(connector.nodeId);
        setLinkingFrom(connector);
        setLinkingCursor(anchor);
      },
      [activePage]
    );

  const handleDeleteLink = useCallback(
    (connector: MindmapConnector) => {
      if (!isMindmapPage(activePage)) return;
      setPages((prev) =>
        prev.map((page) =>
          isMindmapPage(page) && page.id === activePage.id
            ? {
                ...page,
                links: page.links.filter(
                  (link) =>
                    !(link.from.nodeId === connector.nodeId &&
                      link.from.sectionId === connector.sectionId &&
                      link.from.side === connector.side) &&
                    !(link.to.nodeId === connector.nodeId &&
                      link.to.sectionId === connector.sectionId &&
                      link.to.side === connector.side)
                )
              }
            : page
        )
      );
    },
    [activePage]
  );

  const getRowsForText = (text: string): number => {
    const lineCount = (text.match(/\n/g) || []).length + 1;
    return Math.max(1, lineCount);
  };
  const renderMindmap = (page: MindmapPage) => {
    const selectedNode = page.nodes.find((node) => node.id === selectedNodeId) ?? null;
    const selectedTextBox = (page.textBoxes || []).find((tb) => tb.id === selectedTextBoxId) ?? null;
    return (
      <>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <input
            value={page.title}
            onChange={(event) => handleTitleChange(event.target.value)}
            placeholder="ページタイトル"
            style={{
              width: "100%",
              border: "none",
              borderBottom: `2px solid var(--border)`,
              background: "transparent",
              color: "inherit",
              fontSize: 24,
              fontWeight: 600,
              paddingBottom: 12,
              marginBottom: 8
            }}
          />
          <button
            type="button"
            onClick={() => setIsToolsOpen(!isToolsOpen)}
            title={isToolsOpen ? "ツールを閉じる" : "ツールを開く"}
            style={{
              border: "none",
              background: "transparent",
              color: "inherit",
              cursor: "pointer",
              fontSize: 20,
              padding: "0.5rem",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0
            }}
          >
            {isToolsOpen ? <RxDoubleArrowUp /> : <RxDoubleArrowDown />}
          </button>
        </div>
        {isToolsOpen && (
          <>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 16,
                alignItems: "center",
                justifyContent: "space-between"
              }}
            >
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 12,
                  alignItems: "center",
              minWidth: 0
            }}
          >
            <label style={{ display: "flex", flexDirection: "column", fontSize: 12, gap: 4 }}>
              <span style={{ opacity: 0.8 }}>ヘッダータイトル</span>
              <input
                value={selectedNode?.title ?? ""}
                onChange={(event) => handleSelectedNodeTitleChange(event.target.value)}
                placeholder="パネル名"
                disabled={!selectedNode}
                style={{
                  minWidth: 160,
                  borderRadius: 10,
                  border: `1px solid var(--border)`,
                  padding: "0.35rem 0.5rem",
                  background: selectedNode ? "var(--panel)" : "var(--panel-minor)",
                  color: "inherit",
                  cursor: selectedNode ? "text" : "not-allowed",
                  opacity: selectedNode ? 1 : 0.5
                }}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", fontSize: 12, gap: 4 }}>
              <span style={{ opacity: 0.8 }}>値（1-100）</span>
              <input
                type="number"
                min="1"
                max="100"
                value={selectedNode?.value ?? 50}
                onChange={(event) => handleSelectedNodeValueChange(parseInt(event.target.value) || 50)}
                disabled={!selectedNode}
                style={{
                  width: 80,
                  borderRadius: 10,
                  border: `1px solid var(--border)`,
                  padding: "0.35rem 0.5rem",
                  background: selectedNode ? "var(--panel)" : "var(--panel-minor)",
                  color: "inherit",
                  cursor: selectedNode ? "text" : "not-allowed",
                  opacity: selectedNode ? 1 : 0.5
                }}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", fontSize: 12, gap: 4 }}>
              <span style={{ opacity: 0.8 }}>アイテム文字サイズ</span>
              <input
                type="number"
                min="8"
                max="32"
                value={selectedNode && selectedSectionId ? selectedNode.sections.find(s => s.id === selectedSectionId)?.fontSize ?? 12 : 12}
                onChange={(event) => {
                  if (selectedNode && selectedSectionId) {
                    handleSectionFontSizeChange(selectedNode.id, selectedSectionId, parseInt(event.target.value) || 12);
                  }
                }}
                disabled={!selectedNode || !selectedSectionId}
                style={{
                  width: 80,
                  borderRadius: 10,
                  border: `1px solid var(--border)`,
                  padding: "0.35rem 0.5rem",
                  background: selectedNode && selectedSectionId ? "var(--panel)" : "var(--panel-minor)",
                  color: "inherit",
                  cursor: selectedNode && selectedSectionId ? "text" : "not-allowed",
                  opacity: selectedNode && selectedSectionId ? 1 : 0.5
                }}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", fontSize: 12, gap: 4 }}>
              <span style={{ opacity: 0.8 }}>メモ文字サイズ</span>
              <input
                type="number"
                min="8"
                max="32"
                value={selectedTextBox?.fontSize ?? 11}
                onChange={(event) => {
                  if (selectedTextBox) {
                    handleTextBoxFontSizeChange(selectedTextBox.id, parseInt(event.target.value) || 11);
                  }
                }}
                disabled={!selectedTextBox}
                style={{
                  width: 80,
                  borderRadius: 10,
                  border: `1px solid var(--border)`,
                  padding: "0.35rem 0.5rem",
                  background: selectedTextBox ? "var(--panel)" : "var(--panel-minor)",
                  color: "inherit",
                  cursor: selectedTextBox ? "text" : "not-allowed",
                  opacity: selectedTextBox ? 1 : 0.5
                }}
              />
            </label>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 12, opacity: 0.8 }}>ヘッダー色</span>
              {NODE_COLOR_PRESETS.slice(0, 4).map((color) => {
                const isActive = (selectedNode?.color ?? DEFAULT_NODE_COLOR) === color;
                return (
                  <button
                    key={color}
                    type="button"
                    disabled={!selectedNode}
                    onClick={() => selectedNode && handleSelectedNodeColorChange(color)}
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 8,
                      border: isActive ? `2px solid var(--accent)` : `1px solid var(--border)`,
                      background: color,
                      cursor: selectedNode ? "pointer" : "not-allowed",
                      opacity: selectedNode ? 1 : 0.35
                    }}
                  />
                );
              })}
              <input
                type="color"
                disabled={!selectedNode}
                value={selectedNode?.color ?? DEFAULT_NODE_COLOR}
                onChange={(event) => selectedNode && handleSelectedNodeColorChange(event.target.value)}
                title="カラーピッカー"
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 8,
                  border: `1px solid var(--border)`,
                  cursor: selectedNode ? "pointer" : "not-allowed",
                  opacity: selectedNode ? 1 : 0.35,
                  padding: 2
                }}
              />
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, opacity: 0.8 }}>ズーム</span>
            <button
              type="button"
              onClick={handleZoomOut}
              aria-label="ズームアウト"
              style={{
                width: 28,
                height: 28,
                borderRadius: 8,
                border: `1px solid var(--border)`,
                background: "var(--panel-minor)",
                color: "inherit",
                cursor: "pointer",
                fontSize: 11
              }}
            >
              -
            </button>
            <span
              style={{
                minWidth: 40,
                textAlign: "center",
                fontVariantNumeric: "tabular-nums",
                fontSize: 11
              }}
            >
              {Math.round(mindmapScale * 100)}%
            </span>
            <button
              type="button"
              onClick={handleZoomIn}
              aria-label="ズームイン"
              style={{
                width: 28,
                height: 28,
                borderRadius: 8,
                border: `1px solid var(--border)`,
                background: "var(--panel-minor)",
                color: "inherit",
                cursor: "pointer",
                fontSize: 11
              }}
            >
              +
            </button>
            <button
              type="button"
              onClick={handleZoomReset}
              style={{
                borderRadius: 8,
                border: `1px solid var(--border)`,
                background: "transparent",
                color: "inherit",
                padding: "0.25rem 0.5rem",
                cursor: "pointer",
                fontSize: 11
              }}
            >
              リセット
            </button>
            <button
              type="button"
              onClick={handleFitAllNodes}
              style={{
                borderRadius: 8,
                border: `1px solid var(--border)`,
                background: "transparent",
                color: "inherit",
                padding: "0.25rem 0.5rem",
                cursor: "pointer",
                fontSize: 11
              }}
            >
              全表示
            </button>
            <button
              type="button"
              onClick={handleFocusNode}
              disabled={!selectedNodeId}
              style={{
                borderRadius: 8,
                border: `1px solid var(--border)`,
                background: selectedNodeId ? "transparent" : "var(--panel-minor)",
                color: "inherit",
                padding: "0.25rem 0.5rem",
                cursor: selectedNodeId ? "pointer" : "not-allowed",
                fontSize: 11,
                opacity: selectedNodeId ? 1 : 0.5
              }}
            >
              フォーカス
            </button>
            <button
              type="button"
              onClick={handleMindmapAddNode}
              style={{
                borderRadius: 8,
                border: `1px dashed var(--border)`,
                background: "var(--panel-minor)",
                color: "inherit",
                padding: "0.25rem 0.5rem",
                cursor: "pointer",
                fontSize: 11
              }}
            >
              +パネル
            </button>
            <button
              type="button"
              onClick={handleMindmapAddTextBox}
              style={{
                borderRadius: 8,
                border: `1px dashed var(--border)`,
                background: "var(--panel-minor)",
                color: "inherit",
                padding: "0.25rem 0.5rem",
                cursor: "pointer",
                fontSize: 11
              }}
            >
              +メモ
            </button>
            <button
              type="button"
              onClick={() => selectedNode && handleAddSection(selectedNode.id)}
              disabled={!selectedNode}
              style={{
                borderRadius: 8,
                border: `1px dashed var(--border)`,
                background: selectedNode ? "var(--panel-minor)" : "var(--panel-minor)",
                color: "inherit",
                padding: "0.25rem 0.5rem",
                cursor: selectedNode ? "pointer" : "not-allowed",
                fontSize: 11,
                opacity: selectedNode ? 1 : 0.5
              }}
            >
              +アイテム
            </button>
            <button
              type="button"
              onClick={() => selectedNode && selectedSectionId && handleDeleteSection(selectedNode.id, selectedSectionId)}
              disabled={!selectedNode || !selectedSectionId || selectedNode.sections.length <= 1}
              style={{
                display: "none"
              }}
            >
              -パネル
            </button>
          </div>
        </div>
        </>
        )}
        <div
          ref={mindmapContainerRef}
          onWheel={handleMindmapWheel}
          onMouseDown={handleMindmapMouseDown}
          style={{
            position: "relative",
            flex: 1,
            minHeight: 520,
            borderRadius: 24,
            border: `1px solid var(--border)`,
            background: "var(--panel-minor)",
            overflow: "hidden",
            cursor: isPanning ? "grabbing" : "grab"
          }}
        >
          <div
            ref={mindmapCanvasRef}
            style={{
              position: "relative",
              width: MINDMAP_WIDTH,
              height: MINDMAP_HEIGHT,
              transform: `translate(${mindmapPan.x}px, ${mindmapPan.y}px) scale(${mindmapScale})`,
              transformOrigin: "top left",
              transition: isPanning ? "none" : "transform 0.15s ease-out",
              overflow: "visible"
            }}
          >
            <svg
              width={MINDMAP_WIDTH}
              height={MINDMAP_HEIGHT}
              style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 0, overflow: "visible" }}
            >
              <defs>
                <filter id="glow">
                  <feGaussianBlur stdDeviation="2" result="coloredBlur"/>
                  <feMerge>
                    <feMergeNode in="coloredBlur"/>
                    <feMergeNode in="SourceGraphic"/>
                  </feMerge>
                </filter>
              </defs>
              {page.links.map((link) => {
                let fromPos: { x: number; y: number } | null = null;
                let toPos: { x: number; y: number } | null = null;
                let fromValue = 50;
                let toValue = 50;

                // 接続元の位置と値を取得
                if (link.from.textBoxId) {
                  const fromTextBox = page.textBoxes?.find((tb) => tb.id === link.from.textBoxId);
                  if (!fromTextBox) return null;
                  fromPos = getTextBoxAnchorPosition(fromTextBox, link.from.side as "left" | "right");
                  fromValue = fromTextBox.value;
                } else if (link.from.nodeId && link.from.sectionId) {
                  const fromNode = page.nodes.find((node) => node.id === link.from.nodeId);
                  if (!fromNode) return null;
                  const fromSection = fromNode.sections.find((section) => section.id === link.from.sectionId);
                  if (!fromSection) return null;
                  fromPos = getSectionAnchorPosition(fromNode, fromSection, link.from.side ?? "right");
                  fromValue = fromNode.value;
                }

                // 接続先の位置と値を取得
                if (link.to.textBoxId) {
                  const toTextBox = page.textBoxes?.find((tb) => tb.id === link.to.textBoxId);
                  if (!toTextBox) return null;
                  toPos = getTextBoxAnchorPosition(toTextBox, link.to.side as "left" | "right");
                  toValue = toTextBox.value;
                } else if (link.to.nodeId && link.to.sectionId) {
                  const toNode = page.nodes.find((node) => node.id === link.to.nodeId);
                  if (!toNode) return null;
                  const toSection = toNode.sections.find((section) => section.id === link.to.sectionId);
                  if (!toSection) return null;
                  toPos = getSectionAnchorPosition(toNode, toSection, link.to.side ?? "left");
                  toValue = toNode.value;
                }

                if (!fromPos || !toPos) return null;

                // メモが関わっている場合は、パネル側の値のみを使用
                let strokeWidth: number;
                if (link.from.textBoxId) {
                  // メモ→パネル：接続先（パネル）の値を使用
                  const toNode = page.nodes.find((node) => node.id === link.to.nodeId);
                  strokeWidth = toNode ? 1 + (toNode.value / 100) * 12 : 7;
                } else if (link.to.textBoxId) {
                  // パネル→メモ：接続元（パネル）の値を使用
                  const fromNode = page.nodes.find((node) => node.id === link.from.nodeId);
                  strokeWidth = fromNode ? 1 + (fromNode.value / 100) * 12 : 7;
                } else {
                  // パネル→パネル：平均値を使用（元の動作）
                  const fromStrokeWidth = 1 + (fromValue / 100) * 12;
                  const toStrokeWidth = 1 + (toValue / 100) * 12;
                  strokeWidth = (fromStrokeWidth + toStrokeWidth) / 2;
                }

                // グロウ強度とセグメント計算
                const avgValue = (fromValue + toValue) / 2;
                const glowIntensity = avgValue / 100;

                // 線を10セグメントに分割してグラデーション効果を作る
                const segments = 10;
                const lineSegments = [];
                const isTextBoxInvolved = link.from.textBoxId || link.to.textBoxId;
                
                for (let i = 0; i < segments; i++) {
                  const t1 = i / segments;
                  const t2 = (i + 1) / segments;
                  const x1 = fromPos.x + (toPos.x - fromPos.x) * t1;
                  const y1 = fromPos.y + (toPos.y - fromPos.y) * t1;
                  const x2 = fromPos.x + (toPos.x - fromPos.x) * t2;
                  const y2 = fromPos.y + (toPos.y - fromPos.y) * t2;
                  
                  let segmentWidth: number;
                  let segmentOpacity: number;
                  
                  if (isTextBoxInvolved) {
                    // メモが関わっている場合：太さは一定、不透明度も一定
                    segmentWidth = strokeWidth;
                    segmentOpacity = 0.7;
                  } else {
                    // パネル→パネル：グラデーション効果
                    const fromStrokeWidth = 1 + (fromValue / 100) * 12;
                    const toStrokeWidth = 1 + (toValue / 100) * 12;
                    const normalizedWidth = (strokeWidth - 1) / 12; // 0～1に正規化
                    segmentWidth = fromStrokeWidth + (toStrokeWidth - fromStrokeWidth) * ((t1 + t2) / 2);
                    
                    if (theme === "dark") {
                      segmentOpacity = 0.4 + normalizedWidth * 0.6;
                    } else {
                      segmentOpacity = 1.0 - normalizedWidth * 0.6;
                    }
                  }
                  
                  lineSegments.push({ x1, y1, x2, y2, width: segmentWidth, opacity: segmentOpacity });
                }
                
                return (
                  <g key={link.id}>
                    {/* グロウ用の背景線セグメント */}
                    {lineSegments.map((seg, idx) => (
                      <line
                        key={`glow-${idx}`}
                        x1={seg.x1}
                        y1={seg.y1}
                        x2={seg.x2}
                        y2={seg.y2}
                        stroke="#94a3b8"
                        strokeWidth={seg.width + 2}
                        opacity={glowIntensity * 0.3}
                        filter="url(#glow)"
                      />
                    ))}
                    {/* メイン線セグメント */}
                    {lineSegments.map((seg, idx) => (
                      <line
                        key={`main-${idx}`}
                        x1={seg.x1}
                        y1={seg.y1}
                        x2={seg.x2}
                        y2={seg.y2}
                        stroke="#94a3b8"
                        strokeWidth={seg.width}
                        opacity={seg.opacity}
                      />
                    ))}
                  </g>
                );
              })}
              {linkingFrom && linkingCursor && (() => {
                // テキストボックスからの接続の場合
                if (linkingFrom.textBoxId) {
                  const sourceTextBox = page.textBoxes?.find((tb) => tb.id === linkingFrom.textBoxId);
                  if (!sourceTextBox) return null;
                  const sourceAnchor = getTextBoxAnchorPosition(sourceTextBox, linkingFrom.side as "left" | "right");
                  return (
                    <line
                      x1={sourceAnchor.x}
                      y1={sourceAnchor.y}
                      x2={linkingCursor.x}
                      y2={linkingCursor.y}
                      stroke="#60a5fa"
                      strokeWidth={2}
                      strokeDasharray="4 4"
                    />
                  );
                }
                
                // ノード（パネル）からの接続の場合
                const sourceNode = page.nodes.find((node) => node.id === linkingFrom.nodeId);
                if (!sourceNode) return null;
                const sourceSection = sourceNode.sections.find((s) => s.id === linkingFrom.sectionId);
                if (!sourceSection) return null;
                const anchor = getSectionAnchorPosition(sourceNode, sourceSection, linkingFrom.side);
                return (
                  <line
                    x1={anchor.x}
                    y1={anchor.y}
                    x2={linkingCursor.x}
                    y2={linkingCursor.y}
                    stroke="#60a5fa"
                    strokeWidth={2}
                    strokeDasharray="4 4"
                  />
                );
              })()}
            </svg>
            {page.nodes.map((node) => {
              const isLinkingSource = linkingFrom?.nodeId === node.id;
              const nodeColor = node.color ?? DEFAULT_NODE_COLOR;
              const nodeTitle = node.title || DEFAULT_NODE_TITLE;
              return (
                <div
                  key={node.id}
                  style={{
                    position: "absolute",
                    left: node.x,
                    top: node.y,
                    width: NODE_WIDTH,
                    borderRadius: 16,
                    border: isLinkingSource ? "2px solid #60a5fa" : `1px solid var(--border)`,
                    boxShadow: isLinkingSource
                      ? `0 0 0 2px rgba(96,165,250,0.35), 0 0 16px 8px ${theme === "dark" ? `rgba(255,255,255,${Math.min(1, node.value / 35)})` : `rgba(0,0,0,${Math.min(0.3, node.value / 117)})`}`
                      : `0 0 16px 8px ${theme === "dark" ? `rgba(255,255,255,${Math.min(1, node.value / 35)})` : `rgba(0,0,0,${Math.min(0.3, node.value / 117)})`}`,
                    background: "var(--panel-overlay)",
                    display: "flex",
                    flexDirection: "column",
                    overflow: "hidden",
                    zIndex: 1,
                    transition: "box-shadow 0.2s ease"
                  }}
                  onMouseDownCapture={() => {
                    setSelectedNodeId(node.id);
                    setSelectedSectionId(null);
                  }}
                >
                  <div
                    onMouseDown={(event) => {
                      setSelectedNodeId(node.id);
                      handleNodeDragStart(event, node);
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setContextMenu({
                        x: event.clientX,
                        y: event.clientY,
                        type: "node",
                        nodeId: node.id
                      });
                    }}
                    aria-label="パネルをドラッグ"
                    style={{
                      cursor: "grab",
                      padding: "0.35rem 0.6rem",
                      background: nodeColor,
                      color: "#fff",
                      fontSize: 12,
                      fontWeight: 600,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      userSelect: "none",
                      boxShadow: "inset 0 -1px 0 rgba(255,255,255,0.25)",
                      borderBottom: "1px solid rgba(0,0,0,0.2)",
                      transition: "none",
                      gap: 8
                    }}
                  >
                    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span
                        aria-hidden="true"
                        style={{
                          width: 14,
                          height: 14,
                          borderRadius: "50%",
                          background: "rgba(255,255,255,0.35)",
                          boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.2)"
                        }}
                      />
                      <span>{nodeTitle}</span>
                    </span>
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <span
                        style={{
                          background: "rgba(0,0,0,0.3)",
                          borderRadius: 6,
                          padding: "0.15rem 0.5rem",
                          fontSize: 10,
                          fontWeight: 700,
                          minWidth: 24,
                          textAlign: "center"
                        }}
                      >
                        {node.value}
                      </span>
                      <span
                        aria-hidden="true"
                        style={{
                          width: 0,
                          height: 0,
                          borderLeft: "6px solid transparent",
                          borderRight: "6px solid transparent",
                          borderTop: "6px solid rgba(255,255,255,0.8)"
                        }}
                      />
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "0.3rem" }}>
                    {node.sections.map((section) => {
                      const isLeftActive =
                        linkingFrom?.nodeId === node.id &&
                        linkingFrom?.sectionId === section.id &&
                        linkingFrom?.side === "left";
                      const isRightActive =
                        linkingFrom?.nodeId === node.id &&
                        linkingFrom?.sectionId === section.id &&
                        linkingFrom?.side === "right";
                      const isSectionLinking = isLeftActive || isRightActive;
                      const hasLeftConnection = page.links.some(
                        (link) =>
                          (link.from.nodeId === node.id &&
                            link.from.sectionId === section.id &&
                            link.from.side === "left") ||
                          (link.to.nodeId === node.id &&
                            link.to.sectionId === section.id &&
                            link.to.side === "left")
                      );
                      const hasRightConnection = page.links.some(
                        (link) =>
                          (link.from.nodeId === node.id &&
                            link.from.sectionId === section.id &&
                            link.from.side === "right") ||
                          (link.to.nodeId === node.id &&
                            link.to.sectionId === section.id &&
                            link.to.side === "right")
                      );
                      return (
                        <div
                          key={section.id}
                          onClick={() => setSelectedSectionId(section.id)}
                          style={{
                            minHeight: NODE_SECTION_HEIGHT,
                            border: isSectionLinking ? `2px solid var(--accent)` : selectedSectionId === section.id ? `2px solid var(--accent)` : `1px solid var(--border)`,
                            borderRadius: 12,
                            background: "var(--panel)",
                            padding: "0.35rem 0.5rem",
                            display: "flex",
                            alignItems: "stretch",
                            gap: 0,
                            position: "relative"
                          }}
                        >
                          <button
                            type="button"
                            onMouseDown={(event) =>
                              handleConnectorMouseDown(event, {
                                nodeId: node.id,
                                sectionId: section.id,
                                side: "left"
                              })
                            }
                            onMouseUp={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              handleConnectorDrop({
                                nodeId: node.id,
                                sectionId: section.id,
                                side: "left"
                              });
                            }}
                            onDoubleClick={() => {
                              handleDeleteLink({
                                nodeId: node.id,
                                sectionId: section.id,
                                side: "left"
                              });
                            }}
                            aria-label="左コネクタ"
                            tabIndex={-1}
                            aria-hidden="true"
                            style={{
                              width: 12,
                              height: 12,
                              borderRadius: "50%",
                              border: isLeftActive ? `2px solid var(--accent)` : `1px solid var(--border)`,
                              background: hasLeftConnection ? "var(--accent)" : isLeftActive ? "var(--accent-surface)" : "var(--panel-minor)",
                              cursor: "default",
                              flexShrink: 0,
                              position: "absolute",
                              left: -6,
                              top: "50%",
                              transform: "translateY(-50%)",
                              padding: 0,
                              outline: "none"
                            }}
                          />
                          <textarea
                            value={section.text}
                            onFocus={() => {
                              setSelectedNodeId(node.id);
                              setSelectedSectionId(section.id);
                            }}
                            onContextMenu={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              setContextMenu({
                                x: event.clientX,
                                y: event.clientY,
                                type: "section",
                                nodeId: node.id,
                                sectionId: section.id
                              });
                            }}
                            onChange={(event) => handleSectionTextChange(node.id, section.id, event.target.value)}
                            onBlur={() => setSelectedSectionId(null)}
                            rows={getRowsForText(section.text)}
                            style={{
                              border: "none",
                              borderRadius: 8,
                              background: "var(--panel-minor)",
                              color: "var(--fg)",
                              resize: "none",
                              fontSize: section.fontSize ?? 12,
                              lineHeight: 1.2,
                              padding: "0.15rem 0.45rem",
                              flex: 1,
                              outline: "none"
                            }}
                          />
                          <button
                            type="button"
                            onMouseDown={(event) =>
                              handleConnectorMouseDown(event, {
                                nodeId: node.id,
                                sectionId: section.id,
                                side: "right"
                              })
                            }
                            onMouseUp={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              handleConnectorDrop({
                                nodeId: node.id,
                                sectionId: section.id,
                                side: "right"
                              });
                            }}
                            onDoubleClick={() => {
                              handleDeleteLink({
                                nodeId: node.id,
                                sectionId: section.id,
                                side: "right"
                              });
                            }}
                            aria-label="右コネクタ"
                            tabIndex={-1}
                            aria-hidden="true"
                            style={{
                              width: 12,
                              height: 12,
                              borderRadius: "50%",
                              border: isRightActive ? `2px solid var(--accent)` : `1px solid var(--border)`,
                              background: hasRightConnection ? "var(--accent)" : isRightActive ? "var(--accent-surface)" : "var(--panel-minor)",
                              cursor: "default",
                              flexShrink: 0,
                              position: "absolute",
                              right: -6,
                              top: "50%",
                              transform: "translateY(-50%)",
                              padding: 0,
                              outline: "none"
                            }}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            {(page.textBoxes || []).map((textBox) => {
              const isSelected = selectedTextBoxId === textBox.id;
              const textBoxColor = textBox.color ?? DEFAULT_NODE_COLOR;
              const isLinkingSource = linkingFrom?.textBoxId === textBox.id;
              const hasConnection = page.links.some(
                (link) =>
                  (link.from.textBoxId === textBox.id) || (link.to.textBoxId === textBox.id)
              );
              return (
                <div
                  key={textBox.id}
                  style={{
                    position: "absolute",
                    left: textBox.x,
                    top: textBox.y,
                    transform: "translateX(-50%)",
                    width: "auto",
                    minWidth: "80px",
                    maxWidth: "300px",
                    borderRadius: 12,
                    border: isSelected ? `2px solid var(--accent)` : isLinkingSource ? `2px solid #60a5fa` : `1px solid var(--border)`,
                    background: "var(--panel)",
                    display: "flex",
                    flexDirection: "column",
                    overflow: "visible",
                    zIndex: 10,
                    transition: "box-shadow 0.2s ease",
                    padding: "0.45rem"
                  }}
                  onMouseDown={(event) => {
                    if (event.button === 0) {
                      setSelectedTextBoxId(textBox.id);
                      handleTextBoxDragStart(event, textBox);
                    }
                  }}
                  onMouseUp={(event) => {
                    if (linkingFrom) {
                      event.preventDefault();
                      event.stopPropagation();
                      handleConnectorDrop({
                        textBoxId: textBox.id,
                        side: "right"
                      });
                    }
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setContextMenu({
                      x: event.clientX,
                      y: event.clientY,
                      type: "textbox",
                      textBoxId: textBox.id
                    });
                  }}
                  aria-label="メモをドラッグ"
                >
                  {/* テキストコンテンツ */}
                  <div
                    style={{
                      cursor: editingTextBoxId === textBox.id ? "text" : "grab",
                      padding: "0.35rem 0.5rem",
                      background: "var(--panel)",
                      color: "inherit",
                      fontSize: 12,
                      fontWeight: 500,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      userSelect: "none",
                      borderRadius: 12,
                      transition: "none",
                      gap: 6,
                      minHeight: "30px",
                      position: "relative"
                    }}
                  >
                    {editingTextBoxId === textBox.id ? (
                      <input
                        ref={editingTextBoxRefRef as React.RefObject<HTMLInputElement>}
                        type="text"
                        autoFocus
                        value={textBox.text}
                        onChange={(event) => {
                          handleSelectedTextBoxTextChange(event.target.value);
                        }}
                        onBlur={() => setEditingTextBoxId(null)}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") {
                            setEditingTextBoxId(null);
                            (event.target as HTMLInputElement).blur();
                          } else if (event.key === "Enter") {
                            event.preventDefault();
                            setEditingTextBoxId(null);
                            (event.target as HTMLInputElement).blur();
                          }
                        }}
                        onClick={(event) => event.stopPropagation()}
                        onMouseDown={(event) => event.stopPropagation()}
                        style={{
                          background: "transparent",
                          border: "none",
                          color: "inherit",
                          fontSize: `${textBox.fontSize ?? 11}px`,
                          fontWeight: 500,
                          textAlign: "left",
                          flex: 1,
                          minWidth: 0,
                          height: "32px",
                          outline: "none",
                          fontFamily: "inherit",
                          padding: "0.25rem 0"
                        }}
                      />
                    ) : (
                      <span
                        onDoubleClick={(event) => {
                          event.stopPropagation();
                          setEditingTextBoxId(textBox.id);
                        }}
                        style={{
                          flex: 1,
                          textAlign: "left",
                          fontSize: `${textBox.fontSize ?? 11}px`,
                          fontWeight: 500,
                          cursor: "text",
                          userSelect: "text",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          minHeight: "32px",
                          display: "flex",
                          alignItems: "center",
                          lineHeight: "1.4"
                        }}
                      >
                        {textBox.text}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        
        {/* コンテキストメニュー */}
        {contextMenu && (
          <>
            <div
              style={{
                position: "fixed",
                inset: 0,
                zIndex: 1000
              }}
              onMouseDown={() => setContextMenu(null)}
            />
            <div
              style={{
                position: "fixed",
                left: contextMenu.x,
                top: contextMenu.y,
                zIndex: 1001,
                background: "var(--panel)",
                border: `1px solid var(--border)`,
                borderRadius: 8,
                overflow: "hidden",
                boxShadow: "0 4px 12px rgba(0,0,0,0.15)"
              }}
            >
              {contextMenu.type === "node" && (
                <button
                  onClick={() => {
                    if (contextMenu.nodeId) {
                      handleDeleteNode();
                    }
                    setContextMenu(null);
                  }}
                  style={{
                    width: "100%",
                    border: "none",
                    background: "transparent",
                    color: "inherit",
                    padding: "0.5rem 1rem",
                    cursor: "pointer",
                    fontSize: 13,
                    textAlign: "left",
                    transition: "background 0.2s"
                  }}
                  onMouseEnter={(e) => {
                    (e.target as HTMLButtonElement).style.background = "var(--panel-minor)";
                  }}
                  onMouseLeave={(e) => {
                    (e.target as HTMLButtonElement).style.background = "transparent";
                  }}
                >
                  パネルを削除
                </button>
              )}
              {contextMenu.type === "section" && (
                <button
                  onClick={() => {
                    if (contextMenu.nodeId && contextMenu.sectionId) {
                      handleDeleteSection(contextMenu.nodeId, contextMenu.sectionId);
                    }
                    setContextMenu(null);
                  }}
                  style={{
                    width: "100%",
                    border: "none",
                    background: "transparent",
                    color: "inherit",
                    padding: "0.5rem 1rem",
                    cursor: "pointer",
                    fontSize: 13,
                    textAlign: "left",
                    transition: "background 0.2s"
                  }}
                  onMouseEnter={(e) => {
                    (e.target as HTMLButtonElement).style.background = "var(--panel-minor)";
                  }}
                  onMouseLeave={(e) => {
                    (e.target as HTMLButtonElement).style.background = "transparent";
                  }}
                >
                  アイテムを削除
                </button>
              )}
              {contextMenu.type === "textbox" && (
                <button
                  onClick={() => {
                    if (contextMenu.textBoxId) {
                      setSelectedTextBoxId(contextMenu.textBoxId);
                      handleDeleteTextBox();
                    }
                    setContextMenu(null);
                  }}
                  style={{
                    width: "100%",
                    border: "none",
                    background: "transparent",
                    color: "inherit",
                    padding: "0.5rem 1rem",
                    cursor: "pointer",
                    fontSize: 13,
                    textAlign: "left",
                    transition: "background 0.2s"
                  }}
                  onMouseEnter={(e) => {
                    (e.target as HTMLButtonElement).style.background = "var(--panel-minor)";
                  }}
                  onMouseLeave={(e) => {
                    (e.target as HTMLButtonElement).style.background = "transparent";
                  }}
                >
                  メモを削除
                </button>
              )}
            </div>
          </>
        )}
      </>
    );
  };

  const renderQA = (page: QAPage) => {
    const selectedCard = page.cards.find((card) => card.id === selectedQACardId) ?? page.cards[0] ?? null;
    return (
      <div style={{ display: "flex", gap: 16, flex: 1, minHeight: 0 }}>
        <div
          style={{
            width: 320,
            border: `1px solid var(--border)`,
            borderRadius: 18,
            background: "var(--panel-minor)",
            padding: "1rem",
            display: "flex",
            flexDirection: "column",
            gap: 12
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <strong style={{ fontSize: 14 }}>質問カード</strong>
            <button
              type="button"
              onClick={handleAddQACard}
              style={{
                border: "none",
                background: "var(--accent)",
                color: "var(--accent-contrast)",
                borderRadius: 999,
                padding: "0.4rem 0.9rem",
                cursor: "pointer",
                fontSize: 12
              }}
            >
              カード追加
            </button>
          </div>
          <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
            {page.cards.length === 0 ? (
              <p style={{ opacity: 0.7 }}>まだカードがありません。追加して質問を書きましょう。</p>
            ) : (
              page.cards.map((card) => {
                const isActive = card.id === selectedCard?.id;
                return (
                  <button
                    key={card.id}
                    type="button"
                    onClick={() => setSelectedQACardId(card.id)}
                    style={{
                      borderRadius: 12,
                      border: isActive ? `2px solid var(--accent)` : `1px solid var(--border)`,
                      padding: "0.75rem",
                      background: isActive ? "var(--panel-focus)" : "var(--panel)",
                      color: "inherit",
                      textAlign: "left",
                      cursor: "pointer",
                      display: "flex",
                      flexDirection: "column",
                      gap: 4
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <strong style={{ fontSize: 14 }}>{card.title || "無題の質問"}</strong>
                      <span style={{ fontSize: 11, opacity: 0.7 }}>{card.answers.length} 件の回答</span>
                    </div>
                    <p style={{ margin: 0, fontSize: 13, color: "var(--fg-muted)", whiteSpace: "normal", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {card.description || "質問の詳細を記入できます。"}
                    </p>
                  </button>
                );
              })
            )}
          </div>
        </div>
        <div
          style={{
            flex: 1,
            border: `1px solid var(--border)`,
            borderRadius: 18,
            background: "var(--panel)",
            padding: "1rem",
            display: "flex",
            flexDirection: "column",
            gap: 12,
            minHeight: 0
          }}
        >
          {selectedCard ? (
            <>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label style={{ fontSize: 12, opacity: 0.7 }}>質問タイトル</label>
                <input
                  value={selectedCard.title}
                  onChange={(event) => handleQACardFieldChange(selectedCard.id, "title", event.target.value)}
                  style={{
                    borderRadius: 10,
                    border: `1px solid var(--border)`,
                    padding: "0.45rem 0.6rem",
                    fontSize: 15,
                    background: "var(--panel-minor)",
                    color: "inherit"
                  }}
                />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label style={{ fontSize: 12, opacity: 0.7 }}>詳細</label>
                <textarea
                  value={selectedCard.description}
                  onChange={(event) => handleQACardFieldChange(selectedCard.id, "description", event.target.value)}
                  rows={4}
                  style={{
                    borderRadius: 10,
                    border: `1px solid var(--border)`,
                    padding: "0.5rem 0.6rem",
                    fontSize: 14,
                    background: "var(--panel-minor)",
                    color: "inherit",
                    resize: "vertical",
                    minHeight: 120
                  }}
                />
              </div>
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8, minHeight: 0 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <strong style={{ fontSize: 14 }}>回答</strong>
                  <span style={{ fontSize: 12, opacity: 0.7 }}>{selectedCard.answers.length} 件</span>
                </div>
                <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
                  {selectedCard.answers.length === 0 ? (
                    <p style={{ opacity: 0.6 }}>まだ回答がありません。誰かに答えてもらいましょう。</p>
                  ) : (
                    selectedCard.answers.map((answer) => (
                      <article
                        key={answer.id}
                        style={{
                          borderRadius: 12,
                          border: `1px solid var(--border)`,
                          background: "var(--panel-minor)",
                          padding: "0.65rem",
                          fontSize: 14,
                          display: "flex",
                          flexDirection: "column",
                          gap: 4
                        }}
                      >
                        <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{answer.text}</p>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, fontSize: 11, opacity: 0.6 }}>
                          <span>{new Date(answer.createdAt).toLocaleString()}</span>
                          <button
                            type="button"
                            onClick={() => handleDeleteQAAnswer(selectedCard.id, answer.id)}
                            style={{
                              border: "none",
                              background: "transparent",
                              color: "inherit",
                              cursor: "pointer",
                              fontSize: 11,
                              padding: 0,
                              textDecoration: "underline"
                            }}
                          >
                            削除
                          </button>
                        </div>
                      </article>
                    ))
                  )}
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                  <textarea
                    value={qaAnswerDraft}
                    onChange={(event) => setQaAnswerDraft(event.target.value)}
                    placeholder="回答を入力...（Shift+Enter で改行、投稿後も保存されます）"
                    rows={3}
                    style={{
                      flex: 1,
                      borderRadius: 10,
                      border: `1px solid var(--border)`,
                      padding: "0.5rem 0.6rem",
                      fontSize: 14,
                      background: "var(--panel-minor)",
                      color: "inherit",
                      resize: "vertical"
                    }}
                  />
                  <button
                    type="button"
                    onClick={handleAddQAAnswer}
                    disabled={!qaAnswerDraft.trim()}
                    style={{
                      borderRadius: 10,
                      border: "none",
                      background: qaAnswerDraft.trim() ? "var(--accent)" : "var(--panel)",
                      color: qaAnswerDraft.trim() ? "var(--accent-contrast)" : "var(--fg)",
                      padding: "0.6rem 0.9rem",
                      cursor: qaAnswerDraft.trim() ? "pointer" : "not-allowed",
                      fontWeight: 600
                    }}
                  >
                    回答を追加
                  </button>
                </div>
              </div>
            </>
          ) : (
            <p style={{ opacity: 0.7 }}>カードを追加して質問と回答を整理しましょう。</p>
          )}
        </div>
      </div>
    );
  };

  const renderRanking = (page: RankingPage) => {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
          <input
            value={page.title}
            onChange={(event) => handleTitleChange(event.target.value)}
            placeholder="ページタイトル"
            style={{
              flex: 1,
              minWidth: 220,
              border: "none",
              borderBottom: `1px solid var(--border)`,
              background: "transparent",
              color: "inherit",
              fontSize: 20,
              paddingBottom: 6
            }}
          />
          <button
            type="button"
            onClick={handleRankingAddItem}
            style={{
              borderRadius: 999,
              border: `1px dashed var(--border)`,
              background: "var(--panel-minor)",
              color: "inherit",
              padding: "0.45rem 1rem",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 600
            }}
          >
            カードを先頭に追加
          </button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {page.items.length === 0 && <p style={{ opacity: 0.7 }}>まだカードがありません。</p>}
          {page.items.map((item, index) => {
            const isTop = index === 0;
            const isBottom = index === page.items.length - 1;
            return (
              <article
                key={item.id}
                onDragOver={(event) => handleRankingDragOver(item.id, event)}
                onDrop={() => handleRankingDrop(item.id)}
                style={{
                  borderRadius: 16,
                  border:
                    dragOverRankingItemId === item.id
                      ? `2px dashed var(--accent)`
                      : isTop
                      ? `2px solid var(--accent)`
                      : `1px solid var(--border)`,
                  background: "var(--panel-minor)",
                  padding: "0.9rem",
                  boxShadow: isTop ? "0 10px 25px var(--shadow-strong)" : "none",
                  display: "flex",
                  flexDirection: "column",
                  gap: 10
                }}
              >
                <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <input
                    value={item.title}
                    onChange={(e) => handleRankingItemTitleChange(item.id, e.target.value)}
                    placeholder={isTop ? "最優先" : `Priority ${index + 1}`}
                    style={{
                      flex: 1,
                      minWidth: 160,
                      border: "none",
                      borderBottom: `1px solid var(--border)`,
                      background: "transparent",
                      color: "inherit",
                      fontSize: 14,
                      paddingBottom: 4
                    }}
                  />
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <div
                      title="ドラッグして並べ替え"
                      onDragStart={(e) => handleRankingDragStart(item.id, e)}
                      draggable
                      style={{
                        width: 44,
                        height: 32,
                        borderRadius: 8,
                        border: `1px solid var(--border)`,
                        background: "var(--panel)",
                        color: "inherit",
                        cursor: "grab",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        userSelect: "none"
                      }}
                    >
                      :::::
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRankingMoveItem(item.id, "up")}
                      disabled={isTop}
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: 8,
                        border: `1px solid var(--border)`,
                        background: "var(--panel)",
                        color: "inherit",
                        cursor: isTop ? "not-allowed" : "pointer",
                        opacity: isTop ? 0.4 : 1
                      }}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRankingMoveItem(item.id, "down")}
                      disabled={isBottom}
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: 8,
                        border: `1px solid var(--border)`,
                        background: "var(--panel)",
                        color: "inherit",
                        cursor: isBottom ? "not-allowed" : "pointer",
                        opacity: isBottom ? 0.4 : 1
                      }}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRankingDeleteItem(item.id)}
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: 8,
                        border: `1px solid var(--border)`,
                        background: "var(--panel)",
                        color: "inherit",
                        cursor: "pointer"
                      }}
                    >
                      ×
                    </button>
                  </div>
                </header>
                <textarea
                  value={item.body}
                  onChange={(event) => handleRankingItemBodyChange(item.id, event.target.value)}
                  rows={4}
                  style={{
                    borderRadius: 12,
                    border: `1px solid var(--border)`,
                    background: "var(--panel)",
                    color: "var(--fg)",
                    padding: "0.6rem",
                    fontSize: 14,
                    lineHeight: 1.5,
                    resize: "vertical"
                  }}
                />
              </article>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <>
      <div style={{ display: "flex", minHeight: "100vh" }}>
        <aside
          style={{
            width: isBoardsOpen ? 260 : 50,
            borderRight: `1px solid var(--border)`,
            padding: "0.8rem",
            display: "flex",
            flexDirection: "column",
            gap: "1rem",
            background: "var(--panel-major)",
            transition: "width 0.2s ease",
            overflow: "visible"
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: isBoardsOpen ? "space-between" : "center" }}>
          {isBoardsOpen && (
            <img
              src="/WhimsyBoard_LOG.png"
              alt="WhimsyBoard"
              style={{
                height: 70,
                width: "auto",
                objectFit: "contain",
                outline: "none"
              }}
            />
          )}
          <button
            type="button"
            onClick={() => setIsBoardsOpen(!isBoardsOpen)}
            style={{
              border: "none",
              background: "transparent",
              color: "inherit",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 4,
              fontSize: 14,
              outline: "none",
              padding: "0.4rem"
            }}
          >
            {isBoardsOpen ? (
              <>
                <GoSidebarExpand size={18} aria-hidden="true" />
                <span style={{ fontSize: 12 }}>閉じる</span>
              </>
            ) : (
              <GoSidebarCollapse size={18} aria-hidden="true" />
            )}
          </button>
        </div>
        {isBoardsOpen && (
          <>
            <nav style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {boards.map((board) => {
              const isActive = board.id === selectedBoardId;
              return (
                <button
                  key={board.id}
                  type="button"
                  onClick={() => handleBoardSelect(board.id)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    background: isActive ? "var(--accent-surface)" : "transparent",
                    border: "none",
                    color: "inherit",
                    padding: "0.5rem 0.8rem",
                    borderRadius: 10,
                    cursor: "pointer",
                    outline: "none"
                  }}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span>{board.icon}</span>
                    <span>{board.name}</span>
                  </span>
                  <span
                    style={{
                      minWidth: 28,
                      textAlign: "center",
                      fontSize: 12,
                      background: board.id === "qa" ? "#16a34a" : board.accent,
                      color: "var(--accent-contrast)",
                      borderRadius: 999,
                      padding: "0.1rem 0.4rem"
                    }}
                  >
                    {boardCounts[board.id] ?? 0}
                  </span>
                </button>
              );
            })}
          </nav>
          <div
            aria-hidden="true"
            style={{
              borderTop: `2px solid var(--border)`,
              margin: "0.75rem 0"
            }}
          />
          <section
            style={{
              border: `1px solid var(--border)`,
              borderRadius: 14,
              padding: "0.7rem",
              background: "var(--panel)",
              display: "flex",
              flexDirection: "column",
              gap: "0.5rem",
              position: "relative"
            }}
            ref={pageMenuRef}
          >
            <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <strong style={{ fontSize: 14 }}>{boards.find((board) => board.id === selectedBoardId)?.name ?? ""}</strong>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <button
                  type="button"
                  onClick={handleAddPage}
                  style={{
                    border: "none",
                    background: "var(--accent)",
                    color: "var(--accent-contrast)",
                    borderRadius: 999,
                    padding: "0.2rem 0.6rem",
                    fontSize: 12,
                    cursor: "pointer",
                    whiteSpace: "nowrap"
                  }}
                >
                  新規
                </button>
              </div>
            </header>
            <button
              type="button"
              onClick={() => setIsPageMenuOpen((prev) => !prev)}
              aria-expanded={isPageMenuOpen}
              style={{
                width: "100%",
                borderRadius: 10,
                border: `1px solid var(--border)`,
                background: "var(--panel-minor)",
                color: "inherit",
                padding: "0.55rem 0.65rem",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                fontSize: 13,
                cursor: "pointer",
                textAlign: "left"
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span>{boards.find((board) => board.id === selectedBoardId)?.icon}</span>
                <span>{pagesForBoard.find((p) => p.id === activePageId)?.title ?? "ページを選択"}</span>
              </span>
              <span aria-hidden="true" style={{ fontSize: 12 }}>{isPageMenuOpen ? "▾" : "▸"}</span>
            </button>
            {isPageMenuOpen && (
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  top: "100%",
                  marginTop: 6,
                  background: "var(--panel)",
                  borderRadius: 12,
                  border: `1px solid var(--border)`,
                  boxShadow: "0 18px 35px rgba(15,23,42,0.25)",
                  maxHeight: 340,
                  overflowY: "auto",
                  zIndex: 15,
                  padding: 8
                }}
              >
                {pagesForBoard.length === 0 && <p style={{ opacity: 0.7, margin: 0 }}>このボードにページはありません。</p>}
                {pagesForBoard.map((page) => {
                  const isCurrent = page.id === activePageId;
                  return (
                    <article
                      key={page.id}
                      role="button"
                      tabIndex={page.boardId === "ranking" ? -1 : 0}
                      onClick={() => {
                        handlePageSelect(page.id);
                        setIsPageMenuOpen(false);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          handlePageSelect(page.id);
                          setIsPageMenuOpen(false);
                        }
                      }}
                      style={{
                        border: isCurrent ? `2px solid var(--accent)` : `1px solid var(--border)`,
                        borderRadius: 10,
                        padding: "0.6rem 0.65rem",
                        background: isCurrent ? "var(--panel-focus)" : "var(--panel-minor)",
                        display: "flex",
                        flexDirection: "column",
                        gap: 6,
                        cursor: "pointer",
                        marginBottom: 6
                      }}
                    >
                      <strong>{page.title}</strong>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, opacity: 0.75 }}>
                        <span>{boards.find((board) => board.id === page.boardId)?.name}</span>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            handleDeletePage(page.id);
                          }}
                          style={{
                            border: "none",
                            background: "transparent",
                            color: "inherit",
                            cursor: "pointer"
                          }}
                        >
                          削除
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
          <div
            aria-hidden="true"
            style={{
              borderTop: `2px solid var(--border)`,
              margin: "0.75rem 0"
            }}
          />
          <div
            style={{
              position: "relative",
              marginTop: 6
            }}
          >
            <button
              type="button"
              onClick={() => setIsProjectMenuOpen((prev) => !prev)}
              aria-expanded={isProjectMenuOpen}
              style={{
                width: "100%",
                borderRadius: 10,
                border: `1px solid var(--border)`,
                background: "var(--panel-minor)",
                color: "inherit",
                padding: "0.5rem 0.6rem",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
                outline: "none"
              }}
            >
              <span>{activeProject?.name ?? "プロジェクトを選択"}</span>
              <span aria-hidden="true" style={{ fontSize: 12 }}>
                {isProjectMenuOpen ? "▾" : "▸"}
              </span>
            </button>
          </div>
          <div
            aria-hidden="true"
            style={{
              borderTop: `2px solid var(--border)`,
              margin: "0.5rem 0"
            }}
          />
          <section
            style={{
              border: `1px solid var(--border)`,
              borderRadius: 14,
              padding: "0.65rem",
              background: "var(--panel)",
              display: "flex",
              flexDirection: "column",
              gap: "0.5rem"
            }}
          >
            <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <FcLock size={18} aria-hidden="true" />
                <strong style={{ fontSize: 14 }}>アカウント</strong>
              </div>
            </header>
            {/* アカウントカード下に保存ボタンと競合UI */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0' }}>
              <button
                onClick={handleManualSave}
                disabled={isDataSyncing || !currentOwnerId}
                style={{ padding: '6px 18px', fontWeight: 'bold', background: '#1976d2', color: '#fff', border: 'none', borderRadius: 4, cursor: isDataSyncing || !currentOwnerId ? 'not-allowed' : 'pointer' }}
              >
                保存
              </button>
              {isDataSyncing && <span style={{ color: '#1976d2' }}>保存中...</span>}
            </div>
            {pendingConflict && (
              <div style={{
                position: 'fixed',
                inset: 0,
                background: 'rgba(15, 23, 42, 0.45)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 1000
              }}>
                <div style={{
                  minWidth: 420,
                  maxWidth: '90vw',
                  borderRadius: 18,
                  padding: '2rem',
                  background: '#fff',
                  border: '1px solid #ffe58f',
                  boxShadow: '0 25px 45px rgba(15,23,42,0.35)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 18
                }}>
                  <div style={{ fontWeight: 'bold', fontSize: 18, marginBottom: 8 }}>競合が発生しました</div>
                  <div style={{ marginBottom: 8 }}>
                    他の人が同じデータを編集・保存したため、内容が競合しています。どちらか、または両方マージして保存できます。
                  </div>
                  <div style={{ display: 'flex', gap: 16 }}>
                    <div style={{ flex: 1, background: '#f5f5f5', borderRadius: 4, padding: 8 }}>
                      <div style={{ fontWeight: 'bold', marginBottom: 4 }}>あなたの編集内容</div>
                      <div>タイトル: {(pendingConflict.local as any).title || (pendingConflict.local as any).name}</div>
                      {typeof (pendingConflict.local as any).content === 'string' && <div>内容: {(pendingConflict.local as any).content.slice(0, 60)}...</div>}
                      {Array.isArray((pendingConflict.local as any).cards) && <div>Q&A数: {(pendingConflict.local as any).cards.length}</div>}
                      {Array.isArray((pendingConflict.local as any).items) && <div>ランキング項目数: {(pendingConflict.local as any).items.length}</div>}
                      {Array.isArray((pendingConflict.local as any).nodes) && <div>ノード数: {(pendingConflict.local as any).nodes.length}</div>}
                      <button style={{ marginTop: 8, background: '#1976d2', color: '#fff', border: 'none', borderRadius: 4, padding: '4px 12px' }} onClick={resolveConflictWithLocal}>自分の内容で上書き</button>
                    </div>
                    <div style={{ flex: 1, background: '#f5f5f5', borderRadius: 4, padding: 8 }}>
                      <div style={{ fontWeight: 'bold', marginBottom: 4 }}>他の人の内容（最新）</div>
                      <div>タイトル: {(pendingConflict.remote as any).title || (pendingConflict.remote as any).name}</div>
                      {typeof (pendingConflict.remote as any).content === 'string' && <div>内容: {(pendingConflict.remote as any).content.slice(0, 60)}...</div>}
                      {Array.isArray((pendingConflict.remote as any).cards) && <div>Q&A数: {(pendingConflict.remote as any).cards.length}</div>}
                      {Array.isArray((pendingConflict.remote as any).items) && <div>ランキング項目数: {(pendingConflict.remote as any).items.length}</div>}
                      {Array.isArray((pendingConflict.remote as any).nodes) && <div>ノード数: {(pendingConflict.remote as any).nodes.length}</div>}
                      <button style={{ marginTop: 8, background: '#888', color: '#fff', border: 'none', borderRadius: 4, padding: '4px 12px' }} onClick={resolveConflictWithRemote}>他の人の内容を採用</button>
                    </div>
                  </div>
                  <div style={{ marginTop: 16, textAlign: 'center' }}>
                    <button style={{ background: '#22c55e', color: '#fff', border: 'none', borderRadius: 4, padding: '6px 24px', fontWeight: 'bold', fontSize: 16 }} onClick={resolveConflictWithMerge}>両方マージして保存</button>
                  </div>
                </div>
              </div>
            )}
              {/* useEffect(() => {}, [projects, firebaseUser, currentOwnerId]); */}
              {/* useEffect(() => {}, [pages, firebaseUser, currentOwnerId]); */}
              {/* useEffect(() => {}, [projects, pages, activeProjectId, activePageId, firebaseUser, localAccount, persistLocalData]); */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 12, opacity: 0.75 }}>現在のアカウント</span>
                <strong style={{ fontSize: 16 }}>
                  {activeAccountLabel || "未ログイン"}
                </strong>
              </div>
              <button
                type="button"
                onClick={
                  isLoggedIn
                    ? handleAccountLogout
                    : () => {
                        setAccountMessage("");
                        setIsAccountModalOpen(true);
                      }
                }
                style={{
                  borderRadius: 9,
                  border: `1px solid var(--border)`,
                  background: "var(--panel-minor)",
                  color: "inherit",
                  padding: "0.4rem 0.7rem",
                  cursor: "pointer",
                  fontSize: 12,
                  whiteSpace: "nowrap"
                }}
              >
                {isLoggedIn ? "ログアウト" : "ログイン"}
              </button>
            </div>
          </section>
          <section
            style={{
              border: `1px solid var(--border)`,
              borderRadius: 14,
              padding: "0.65rem",
              background: "var(--panel)",
              display: "flex",
              flexDirection: "column",
              gap: "0.5rem"
            }}
          >
            <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <FcSettings size={18} aria-hidden="true" />
                <strong style={{ fontSize: 14 }}>設定</strong>
              </div>
            </header>
            <button
              type="button"
              onClick={toggleTheme}
              style={{
                borderRadius: 9,
                border: `1px solid var(--border)`,
                background: "var(--panel-minor)",
                color: "inherit",
                padding: "0.45rem 0.7rem",
                cursor: "pointer",
                fontSize: 12,
                textAlign: "left"
              }}
            >
              {theme === "dark" ? "☀️ ライトモード" : "🌙 ダークモード"}
            </button>
          </section>
          </>
        )}
      </aside>
      {isAccountModalOpen && (
        <div
          role="presentation"
          onClick={handleAccountDialogClose}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 23, 42, 0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 50,
            padding: "1rem"
          }}
        >
          <div
            role="dialog"
            aria-label="アカウントログイン"
            onClick={(event) => event.stopPropagation()}
            style={{
              width: 420,
              maxWidth: "calc(100vw - 2rem)",
              borderRadius: 18,
              padding: "1rem",
              background: "var(--panel)",
              border: `1px solid var(--border)`,
              boxShadow: "0 25px 45px rgba(15,23,42,0.35)",
              display: "flex",
              flexDirection: "column",
              gap: 12
            }}
          >
            <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <strong style={{ fontSize: 14 }}>ログイン</strong>
              <button
                type="button"
                onClick={handleAccountDialogClose}
                style={{
                  border: "none",
                  background: "transparent",
                  color: "inherit",
                  fontSize: 18,
                  lineHeight: 1,
                  cursor: "pointer",
                  padding: 0
                }}
                aria-label="ログインウィンドウを閉じる"
              >
                ×
              </button>
            </header>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
              <span style={{ opacity: 0.75 }}>現在のアカウント</span>
              <div
                style={{
                  borderRadius: 10,
                  border: `1px solid var(--border)`,
                  padding: "0.5rem 0.75rem",
                  background: "var(--panel-minor)",
                  fontWeight: 600
                }}
              >
                {activeAccountLabel || "未ログイン"}
              </div>
            </div>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
              <span style={{ opacity: 0.8 }}>アカウント名</span>
              <input
                value={accountNameInput}
                onChange={(event) => {
                  setAccountNameInput(event.target.value);
                  setAccountMessage("");
                }}
                placeholder="your-name"
                style={{
                  borderRadius: 10,
                  border: `1px solid var(--border)`,
                  padding: "0.45rem 0.6rem",
                  background: "var(--panel-minor)",
                  color: "inherit"
                }}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
              <span style={{ opacity: 0.8 }}>アカウントキー（任意）</span>
              <input
                value={accountKeyInput}
                onChange={(event) => {
                  setAccountKeyInput(event.target.value);
                  setAccountMessage("");
                }}
                placeholder="空でもOK（ローカルのみ保存）"
                style={{
                  borderRadius: 10,
                  border: `1px solid var(--border)`,
                  padding: "0.45rem 0.6rem",
                  background: "var(--panel-minor)",
                  color: "inherit"
                }}
              />
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                onClick={handleLocalAccountLogin}
                disabled={isAuthSigningIn}
                style={{
                  flex: 1,
                  borderRadius: 10,
                  border: `1px solid var(--border)`,
                  background: "var(--panel-minor)",
                  color: "inherit",
                  padding: "0.5rem 0.8rem",
                  cursor: isAuthSigningIn ? "not-allowed" : "pointer",
                  opacity: isAuthSigningIn ? 0.6 : 1,
                  fontSize: 12,
                  textAlign: "center"
                }}
              >
                ログイン（ローカル）
              </button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12 }}>
              <span style={{ opacity: 0.8 }}>Google でログイン</span>
              <button
                type="button"
                onClick={handleGoogleLogin}
                disabled={isAuthSigningIn}
                style={{
                  borderRadius: 10,
                  border: `1px solid var(--border)`,
                  background: "var(--panel-minor)",
                  color: "inherit",
                  padding: "0.5rem 0.8rem",
                  cursor: isAuthSigningIn ? "not-allowed" : "pointer",
                  opacity: isAuthSigningIn ? 0.6 : 1,
                  fontSize: 12,
                  whiteSpace: "nowrap"
                }}
              >
                Googleでログイン
              </button>
            </div>
            {accountMessage && (
              <p style={{ margin: 0, fontSize: 12, color: "var(--fg-muted)" }}>{accountMessage}</p>
            )}
          </div>
        </div>
      )}

              {pendingConflict && !isDataSyncing && (
        <div
          role="presentation"
          onClick={() => setPendingConflict(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 23, 42, 0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 60,
            padding: "1rem"
          }}
        >
          <div
            role="dialog"
            aria-label="競合解決"
            onClick={(event) => event.stopPropagation()}
            style={{
              width: 520,
              maxWidth: "calc(100vw - 2rem)",
              borderRadius: 16,
              padding: "1rem",
              background: "var(--panel)",
              border: `1px solid var(--border)`,
              boxShadow: "0 30px 60px rgba(15,23,42,0.35)",
              display: "flex",
              flexDirection: "column",
              gap: 12
            }}
          >
            <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <strong style={{ fontSize: 14 }}>競合を解決してください</strong>
              <button
                type="button"
                onClick={() => setPendingConflict(null)}
                style={{
                  border: "none",
                  background: "transparent",
                  color: "inherit",
                  fontSize: 18,
                  lineHeight: 1,
                  cursor: "pointer",
                  padding: 0
                }}
                aria-label="競合ダイアログを閉じる"
              >
                ×
              </button>
            </header>
            <p style={{ fontSize: 12, opacity: 0.8, margin: 0 }}>
              他の端末で更新されたため保存に失敗しました。どちらの内容を採用するか選んでください。
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div style={{ border: `1px solid var(--border)`, borderRadius: 12, padding: "0.75rem", background: "var(--panel-minor)" }}>
                <strong style={{ fontSize: 12 }}>ローカルの変更</strong>
                <div style={{ fontSize: 12, opacity: 0.8, marginTop: 6 }}>
                  {pendingConflict.kind === "project" ? (
                    <>
                      <div>名前: {(pendingConflict.local as Project).name}</div>
                      <div>更新版: {(pendingConflict.local as Project).version ?? 0}</div>
                    </>
                  ) : (
                    <>
                      <div>タイトル: {(pendingConflict.local as Page).title}</div>
                      <div>更新版: {(pendingConflict.local as Page).version ?? 0}</div>
                    </>
                  )}
                </div>
              </div>
              <div style={{ border: `1px solid var(--border)`, borderRadius: 12, padding: "0.75rem", background: "var(--panel-minor)" }}>
                <strong style={{ fontSize: 12 }}>リモートの最新</strong>
                <div style={{ fontSize: 12, opacity: 0.8, marginTop: 6 }}>
                  {pendingConflict.kind === "project" ? (
                    <>
                      <div>名前: {(pendingConflict.remote as Project).name}</div>
                      <div>更新版: {(pendingConflict.remote as Project).version ?? 0}</div>
                    </>
                  ) : (
                    <>
                      <div>タイトル: {(pendingConflict.remote as Page).title}</div>
                      <div>更新版: {(pendingConflict.remote as Page).version ?? 0}</div>
                    </>
                  )}
                </div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={resolveConflictWithRemote}
                style={{
                  borderRadius: 10,
                  border: `1px solid var(--border)`,
                  background: "var(--panel-minor)",
                  color: "inherit",
                  padding: "0.45rem 0.8rem",
                  cursor: "pointer",
                  fontSize: 12
                }}
              >
                最新を採用
              </button>
              <button
                type="button"
                onClick={resolveConflictWithLocal}
                disabled={!firebaseUser}
                style={{
                  borderRadius: 10,
                  border: "none",
                  background: "var(--accent)",
                  color: "var(--accent-contrast)",
                  padding: "0.45rem 0.9rem",
                  cursor: firebaseUser ? "pointer" : "not-allowed",
                  opacity: firebaseUser ? 1 : 0.5,
                  fontSize: 12
                }}
              >
                ローカルで上書き
              </button>
            </div>
          </div>
        </div>
      )}
      {isProjectMenuOpen && (
        <div
          role="presentation"
          onClick={() => setIsProjectMenuOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 23, 42, 0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 40,
            padding: "1rem"
          }}
        >
          <div
            ref={projectMenuRef}
            role="dialog"
            aria-label="プロジェクトメニュー"
            onClick={(event) => event.stopPropagation()}
            style={{
              width: 340,
              maxWidth: "calc(100vw - 2rem)",
              borderRadius: 18,
              padding: "1rem",
              background: "var(--panel)",
              border: `1px solid var(--border)`,
              boxShadow: "0 25px 45px rgba(15,23,42,0.35)",
              display: "flex",
              flexDirection: "column",
              gap: 12
            }}
          >
            <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <strong style={{ fontSize: 14 }}>プロジェクト</strong>
              <button
                type="button"
                onClick={() => setIsProjectMenuOpen(false)}
                style={{
                  border: "none",
                  background: "transparent",
                  color: "inherit",
                  fontSize: 18,
                  lineHeight: 1,
                  cursor: "pointer",
                  padding: 0
                }}
                aria-label="プロジェクトメニューを閉じる"
              >
                ×
              </button>
            </header>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 12, color: "var(--fg-muted)" }}>現在のプロジェクト</span>
              <div
                style={{
                  borderRadius: 10,
                  border: `1px solid var(--border)`,
                  padding: "0.4rem 0.75rem",
                  background: "var(--panel-minor)",
                  color: "inherit",
                  fontWeight: 600
                }}
              >
                {activeProject?.name ?? "未選択"}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  value={projectRenameDraft}
                  onChange={(event) => setProjectRenameDraft(event.target.value)}
                  placeholder="名前を変更"
                  style={{
                    flex: 1,
                    borderRadius: 10,
                    border: `1px solid var(--border)`,
                    padding: "0.45rem 0.6rem",
                    background: "var(--panel-minor)",
                    color: "inherit"
                  }}
                />
                <button
                  type="button"
                  onClick={handleRenameProject}
                  disabled={
                    !projectRenameDraft.trim() ||
                    projectRenameDraft.trim() === (activeProject?.name ?? "")
                  }
                  style={{
                    borderRadius: 10,
                    border: "none",
                    background:
                      projectRenameDraft.trim() &&
                      projectRenameDraft.trim() !== (activeProject?.name ?? "")
                        ? "var(--accent)"
                        : "var(--panel)",
                    color:
                      projectRenameDraft.trim() &&
                      projectRenameDraft.trim() !== (activeProject?.name ?? "")
                        ? "var(--accent-contrast)"
                        : "var(--fg-muted)",
                    cursor:
                      projectRenameDraft.trim() &&
                      projectRenameDraft.trim() !== (activeProject?.name ?? "")
                        ? "pointer"
                        : "not-allowed",
                    padding: "0.45rem 0.65rem",
                    fontSize: 12
                  }}
                >
                  保存
                </button>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 12, color: "var(--fg-muted)" }}>プロジェクトを切り替え</span>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                  maxHeight: 160,
                  overflowY: "auto"
                }}
              >
                {projects.map((project) => {
                  const isActive = project.id === activeProjectId;
                  return (
                    <button
                      key={project.id}
                      type="button"
                      onClick={() => handleProjectSelect(project.id)}
                      style={{
                        borderRadius: 10,
                        border: `1px solid ${isActive ? "var(--accent)" : "var(--border)"}`,
                        background: isActive ? "var(--panel-focus)" : "transparent",
                        padding: "0.5rem 0.75rem",
                        textAlign: "left",
                        color: "inherit",
                        cursor: "pointer",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        fontWeight: isActive ? 600 : 400
                      }}
                    >
                      <span>{project.name}</span>
                      {isActive && <span style={{ fontSize: 12 }}>✔</span>}
                    </button>
                  );
                })}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                value={newProjectName}
                onChange={(event) => setNewProjectName(event.target.value)}
                placeholder="新しいプロジェクトを追加"
                style={{
                  flex: 1,
                  borderRadius: 10,
                  border: `1px solid var(--border)`,
                  padding: "0.45rem 0.6rem",
                  background: "var(--panel-minor)",
                  color: "inherit"
                }}
              />
              <button
                type="button"
                onClick={handleAddProject}
                disabled={!newProjectName.trim()}
                style={{
                  borderRadius: 10,
                  border: "none",
                  background: newProjectName.trim() ? "var(--accent)" : "var(--panel)",
                  color: newProjectName.trim() ? "var(--accent-contrast)" : "var(--fg-muted)",
                  cursor: newProjectName.trim() ? "pointer" : "not-allowed",
                  padding: "0.45rem 0.7rem",
                  fontSize: 12
                }}
              >
                追加
              </button>
            </div>
          </div>
        </div>
      )}
      <main style={{ flex: 1, padding: 0, minWidth: 0, height: "100vh" }}>
        <section
          style={{
            flex: 1,
            minWidth: 0,
            border: "none",
            borderRadius: 0,
            padding: "0.75rem 1rem",
            background: "var(--panel)",
            display: "flex",
            flexDirection: "column",
            gap: "0.25rem",
            height: "100%"
          }}
        >
          {isMarkdownPage(activePage) && (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", flex: 1, minHeight: 0, overflow: "hidden" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", flex: "0 0 auto" }}>
                <input
                  value={activePage.title}
                  onChange={(event) => handleTitleChange(event.target.value)}
                  placeholder="ページタイトル"
                  style={{
                    background: "transparent",
                    border: "none",
                    borderBottom: `2px solid var(--border)`,
                    fontSize: 24,
                    fontWeight: 600,
                    paddingBottom: 12,
                    color: "inherit"
                  }}
                />
              </div>
              <textarea
                value={activePage.content}
                onChange={(event) => handleMarkdownChange(event.target.value)}
                style={{
                  flex: 1,
                  minHeight: 0,
                  background: "var(--panel-minor)",
                  color: "var(--fg)",
                  borderRadius: 16,
                  border: `1px solid var(--border)`,
                  padding: "1rem",
                  fontSize: 14,
                  lineHeight: 1.5,
                  resize: "none"
                }}
              />
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", flex: "0 0 auto" }}>
                <button
                  type="button"
                  onClick={handleDownloadMarkdown}
                  style={{
                    background: "var(--accent)",
                    color: "var(--accent-contrast)",
                    border: "none",
                    borderRadius: 999,
                    padding: "0.6rem 1.2rem",
                    cursor: "pointer",
                    fontWeight: 600
                  }}
                >
                  .md をダウンロード
                </button>
                <button
                  type="button"
                  onClick={handleOpenPreview}
                  style={{
                    background: "transparent",
                    border: `1px dashed var(--border)`,
                    borderRadius: 999,
                    padding: "0.6rem 1.2rem",
                    color: "inherit",
                    cursor: "pointer"
                  }}
                >
                  プレビュータブを開く
                </button>
              </div>
            </div>
          )}

          {isMindmapPage(activePage) && renderMindmap(activePage)}

          {isQAPage(activePage) && renderQA(activePage)}

          {isRankingPage(activePage) && renderRanking(activePage)}

          {!activePage && <p style={{ opacity: 0.7 }}>このボードにページがありません。</p>}
        </section>
      </main>
    </div>
    </>
  );
}
