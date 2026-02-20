import { AUTO_PHRASE_TRANSLATIONS } from './autoPhraseTranslations'

export type AppLocale = 'en' | 'zh-CN' | 'zh-TW' | 'ja' | 'ko'

export const DEFAULT_APP_LOCALE: AppLocale = 'en'
export const APP_LOCALE_STORAGE_KEY = 'alloy.locale'

export const APP_LOCALE_OPTIONS: ReadonlyArray<{ value: AppLocale; label: string; shortLabel: string }> = [
  { value: 'en', label: 'English', shortLabel: 'EN' },
  { value: 'zh-CN', label: '简体中文', shortLabel: '简' },
  { value: 'zh-TW', label: '繁體中文', shortLabel: '繁' },
  { value: 'ja', label: '日本語', shortLabel: '日' },
]

export function normalizeAppLocale(value: string | null | undefined): AppLocale {
  const raw = String(value ?? '').trim().toLowerCase()
  if (!raw) return DEFAULT_APP_LOCALE

  if (raw.startsWith('en')) return 'en'
  if (raw.startsWith('ja')) return 'ja'
  if (raw.startsWith('zh-tw') || raw.startsWith('zh-hk') || raw.includes('hant')) return 'zh-TW'
  if (raw.startsWith('zh')) return 'zh-CN'

  return DEFAULT_APP_LOCALE
}

function detectBrowserLocale(): AppLocale {
  try {
    return normalizeAppLocale(navigator.language)
  } catch {
    return DEFAULT_APP_LOCALE
  }
}

export function readAppLocalePreference(): AppLocale {
  try {
    const saved = localStorage.getItem(APP_LOCALE_STORAGE_KEY)
    if (!saved) return detectBrowserLocale()
    return normalizeAppLocale(saved)
  } catch {
    return detectBrowserLocale()
  }
}

export function writeAppLocalePreference(locale: AppLocale): void {
  try {
    localStorage.setItem(APP_LOCALE_STORAGE_KEY, locale)
  } catch {
    // ignore
  }
}

export function appLocaleShortLabel(locale: AppLocale): string {
  const option = APP_LOCALE_OPTIONS.find((item) => item.value === locale)
  return option?.shortLabel ?? APP_LOCALE_OPTIONS[0]!.shortLabel
}

type I18nParamValue = string | number
export type I18nParams = Partial<Record<string, I18nParamValue>>
type MessageValue = string | ((params: I18nParams) => string)

const en = {
  'app.controlPlane': 'Control Plane',
  'status.backend': 'Backend',
  'status.agent': 'Agent',
  'status.offline': 'offline',
  'status.ok': 'ok',

  'header.openMenu': 'Open menu',
  'header.environment': 'Environment',
  'header.readOnlyMode': 'Read-only mode',
  'header.readOnlyBadge': 'READ-ONLY',
  'header.updatesAvailable': 'Updates available',
  'header.updateCenter': 'Update center',
  'header.language': 'Language',
  'header.initializeSession': 'INITIALIZE_SESSION',

  'header.updateCenterTitle': 'Update center',
  'header.updateCenterDesc': 'Auto checks control and agent releases.',
  'header.checking': 'Checking',
  'header.updateAvailable': 'Update available',
  'header.upToDate': 'Up to date',
  'header.control': 'Control',
  'header.current': 'Current',
  'header.latest': 'Latest',
  'header.published': 'Published',
  'header.agent': 'Agent',
  'header.nodesOutdated': ({ count }) => `${count ?? 0} outdated`,
  'header.nodesUpToDate': 'Nodes up to date',
  'header.nodesManageUpdates': ({ count }) => `Nodes ${count ?? 0} · manage updates from Nodes (single or batch)`,
  'header.manifestSource': 'Manifest source',
  'header.compatibility': 'Compatibility',
  'header.failedCheckUpdates': 'Failed to check updates. Use Check now to retry.',
  'header.checkNow': 'Check now',
  'header.openNodes': 'Open Nodes',
  'header.updaterNotConfigured': 'Updater not configured',
  'header.alreadyUpToDate': 'Already up to date',
  'header.triggerControlUpdate': 'Trigger control update',
  'header.updateControl': 'Update control',
  'header.oneClickWatchtowerHint':
    'One-click control update requires Watchtower HTTP API. Set ALLOY_UPDATE_WATCHTOWER_URL on alloy-control.',
  'header.controlReleaseNotes': 'Control release notes',
  'header.catalogFresh': 'Catalog fresh',
  'header.catalogStale': 'Catalog stale',
  'header.catalogUnknown': 'Catalog time unknown',
  'header.lastCatalogSync': 'Last catalog sync',
  'header.roleAdministrator': 'Administrator',
  'header.roleUser': 'User',
  'header.diagnostics': 'Diagnostics',
  'header.logout': 'Logout',
  'header.updateTriggered': 'Update triggered',
  'header.watchtowerUpdateRequested': 'Watchtower update requested.',
  'header.updateFailed': 'Update failed',

  'nav.primary': 'Primary navigation',
  'nav.goToInstances': 'Go to Instances',
  'tab.instances': 'Instances',
  'tab.downloads': 'Downloads',
  'tab.files': 'Files',
  'tab.nodes': 'Nodes',
  'tab.frp': 'Tunnels',
  'tab.settings': 'Settings',
  'sidebar.collapse': 'Collapse sidebar',
  'sidebar.expand': 'Expand sidebar',

  'mobile.menu': 'Menu',
  'mobile.theme': ({ mode }) => `Theme: ${mode ?? ''}`,
  'theme.system': 'System',
  'theme.light': 'Light',
  'theme.dark': 'Dark',
  'mobile.signIn': 'Sign in',

  'auth.workspaceLocked': 'Workspace is locked.',
  'auth.signInPrompt': 'Sign in to manage instances, browse files, and view nodes.',
  'auth.initializeSession': 'INITIALIZE_SESSION',

  'banner.backendOffline': 'Backend offline',
  'banner.agentUnreachable': 'Agent unreachable',
  'banner.lastOk': ({ value }) => `Last ok: ${value ?? '-'}.`,
  'banner.retry': 'Retry',
  'banner.readOnlyMode': 'Read-only mode',
  'banner.readOnlyMessage': 'Instance actions and filesystem writes are disabled.',
  'banner.details': 'Details',
  'banner.readOnlyFilesystem': 'Read-only filesystem',
  'banner.enableFsWrite': 'Enable with ALLOY_FS_WRITE_ENABLED=true.',
  'banner.copyEnvVar': 'Copy env var',

  'toast.copied': 'Copied',
  'toast.fsWriteEnvCopied': 'ALLOY_FS_WRITE_ENABLED=true',
} satisfies Record<string, MessageValue>

export type I18nKey = keyof typeof en
export type I18nTranslate = (key: I18nKey, params?: I18nParams) => string

const zhCN: Partial<Record<I18nKey, MessageValue>> = {
  'app.controlPlane': '控制台',
  'status.backend': '后端',
  'status.agent': 'Agent',
  'status.offline': '离线',
  'status.ok': '正常',

  'header.openMenu': '打开菜单',
  'header.environment': '环境',
  'header.readOnlyMode': '只读模式',
  'header.readOnlyBadge': '只读',
  'header.updatesAvailable': '有可用更新',
  'header.updateCenter': '更新中心',
  'header.language': '语言',
  'header.initializeSession': '登录',

  'header.updateCenterTitle': '更新中心',
  'header.updateCenterDesc': '自动检查 Control 与 Agent 的发布版本。',
  'header.checking': '检查中',
  'header.updateAvailable': '有可用更新',
  'header.upToDate': '已是最新',
  'header.control': 'Control',
  'header.current': '当前',
  'header.latest': '最新',
  'header.published': '发布时间',
  'header.agent': 'Agent',
  'header.nodesOutdated': ({ count }) => `${count ?? 0} 个待更新`,
  'header.nodesUpToDate': '节点已是最新',
  'header.nodesManageUpdates': ({ count }) => `节点 ${count ?? 0} · 可在“节点”中管理更新（单个或批量）`,
  'header.manifestSource': 'Manifest 来源',
  'header.compatibility': '兼容性',
  'header.failedCheckUpdates': '检查更新失败，请使用“立即检查”重试。',
  'header.checkNow': '立即检查',
  'header.openNodes': '打开节点',
  'header.updaterNotConfigured': '更新器未配置',
  'header.alreadyUpToDate': '已经是最新',
  'header.triggerControlUpdate': '触发 Control 更新',
  'header.updateControl': '更新 Control',
  'header.oneClickWatchtowerHint': '一键更新需要 Watchtower HTTP API。请在 alloy-control 上设置 ALLOY_UPDATE_WATCHTOWER_URL。',
  'header.controlReleaseNotes': 'Control 发布说明',
  'header.catalogFresh': '目录新鲜',
  'header.catalogStale': '目录偏旧',
  'header.catalogUnknown': '目录时间未知',
  'header.lastCatalogSync': '目录最近同步',
  'header.roleAdministrator': '管理员',
  'header.roleUser': '用户',
  'header.diagnostics': '诊断',
  'header.logout': '退出登录',
  'header.updateTriggered': '已触发更新',
  'header.watchtowerUpdateRequested': '已请求 Watchtower 执行更新。',
  'header.updateFailed': '更新失败',

  'nav.primary': '主导航',
  'nav.goToInstances': '前往实例',
  'tab.instances': '实例',
  'tab.downloads': '下载',
  'tab.files': '文件',
  'tab.nodes': '节点',
  'tab.frp': '隧道',
  'tab.settings': '设置',
  'sidebar.collapse': '收起侧边栏',
  'sidebar.expand': '展开侧边栏',

  'mobile.menu': '菜单',
  'mobile.theme': ({ mode }) => `主题：${mode ?? ''}`,
  'theme.system': '跟随系统',
  'theme.light': '浅色',
  'theme.dark': '深色',
  'mobile.signIn': '登录',

  'auth.workspaceLocked': '工作区已锁定。',
  'auth.signInPrompt': '登录后即可管理实例、浏览文件并查看节点。',
  'auth.initializeSession': '开始会话',

  'banner.backendOffline': '后端离线',
  'banner.agentUnreachable': 'Agent 不可达',
  'banner.lastOk': ({ value }) => `最近可用：${value ?? '-'}。`,
  'banner.retry': '重试',
  'banner.readOnlyMode': '只读模式',
  'banner.readOnlyMessage': '实例操作与文件写入已禁用。',
  'banner.details': '详情',
  'banner.readOnlyFilesystem': '只读文件系统',
  'banner.enableFsWrite': '可通过 ALLOY_FS_WRITE_ENABLED=true 启用写入。',
  'banner.copyEnvVar': '复制环境变量',

  'toast.copied': '已复制',
  'toast.fsWriteEnvCopied': 'ALLOY_FS_WRITE_ENABLED=true',
}

const zhTW: Partial<Record<I18nKey, MessageValue>> = {
  'app.controlPlane': '控制台',
  'status.backend': '後端',
  'status.agent': 'Agent',
  'status.offline': '離線',
  'status.ok': '正常',

  'header.openMenu': '開啟選單',
  'header.environment': '環境',
  'header.readOnlyMode': '唯讀模式',
  'header.readOnlyBadge': '唯讀',
  'header.updatesAvailable': '有可用更新',
  'header.updateCenter': '更新中心',
  'header.language': '語言',
  'header.initializeSession': '登入',

  'header.updateCenterTitle': '更新中心',
  'header.updateCenterDesc': '自動檢查 Control 與 Agent 的發佈版本。',
  'header.checking': '檢查中',
  'header.updateAvailable': '有可用更新',
  'header.upToDate': '已是最新',
  'header.control': 'Control',
  'header.current': '目前',
  'header.latest': '最新',
  'header.published': '發佈時間',
  'header.agent': 'Agent',
  'header.nodesOutdated': ({ count }) => `${count ?? 0} 個待更新`,
  'header.nodesUpToDate': '節點已是最新',
  'header.nodesManageUpdates': ({ count }) => `節點 ${count ?? 0} · 可在「節點」中管理更新（單個或批次）`,
  'header.manifestSource': 'Manifest 來源',
  'header.compatibility': '相容性',
  'header.failedCheckUpdates': '檢查更新失敗，請使用「立即檢查」重試。',
  'header.checkNow': '立即檢查',
  'header.openNodes': '開啟節點',
  'header.updaterNotConfigured': '更新器未設定',
  'header.alreadyUpToDate': '已經是最新',
  'header.triggerControlUpdate': '觸發 Control 更新',
  'header.updateControl': '更新 Control',
  'header.oneClickWatchtowerHint': '一鍵更新需要 Watchtower HTTP API。請在 alloy-control 上設定 ALLOY_UPDATE_WATCHTOWER_URL。',
  'header.controlReleaseNotes': 'Control 發佈說明',
  'header.catalogFresh': '目錄最新',
  'header.catalogStale': '目錄偏舊',
  'header.catalogUnknown': '目錄時間未知',
  'header.lastCatalogSync': '目錄最近同步',
  'header.roleAdministrator': '管理員',
  'header.roleUser': '使用者',
  'header.diagnostics': '診斷',
  'header.logout': '登出',
  'header.updateTriggered': '已觸發更新',
  'header.watchtowerUpdateRequested': '已請求 Watchtower 執行更新。',
  'header.updateFailed': '更新失敗',

  'nav.primary': '主導覽',
  'nav.goToInstances': '前往實例',
  'tab.instances': '實例',
  'tab.downloads': '下載',
  'tab.files': '檔案',
  'tab.nodes': '節點',
  'tab.frp': '隧道',
  'tab.settings': '設定',
  'sidebar.collapse': '收合側邊欄',
  'sidebar.expand': '展開側邊欄',

  'mobile.menu': '選單',
  'mobile.theme': ({ mode }) => `主題：${mode ?? ''}`,
  'theme.system': '跟隨系統',
  'theme.light': '淺色',
  'theme.dark': '深色',
  'mobile.signIn': '登入',

  'auth.workspaceLocked': '工作區已鎖定。',
  'auth.signInPrompt': '登入後即可管理實例、瀏覽檔案並查看節點。',
  'auth.initializeSession': '開始工作階段',

  'banner.backendOffline': '後端離線',
  'banner.agentUnreachable': 'Agent 無法連線',
  'banner.lastOk': ({ value }) => `最近可用：${value ?? '-'}。`,
  'banner.retry': '重試',
  'banner.readOnlyMode': '唯讀模式',
  'banner.readOnlyMessage': '實例操作與檔案寫入已停用。',
  'banner.details': '詳情',
  'banner.readOnlyFilesystem': '唯讀檔案系統',
  'banner.enableFsWrite': '可透過 ALLOY_FS_WRITE_ENABLED=true 啟用寫入。',
  'banner.copyEnvVar': '複製環境變數',

  'toast.copied': '已複製',
  'toast.fsWriteEnvCopied': 'ALLOY_FS_WRITE_ENABLED=true',
}

const ja: Partial<Record<I18nKey, MessageValue>> = {
  'app.controlPlane': 'コントロールプレーン',
  'status.backend': 'バックエンド',
  'status.agent': 'Agent',
  'status.offline': 'オフライン',
  'status.ok': '正常',

  'header.openMenu': 'メニューを開く',
  'header.environment': '環境',
  'header.readOnlyMode': '読み取り専用モード',
  'header.readOnlyBadge': '読み取り専用',
  'header.updatesAvailable': '更新があります',
  'header.updateCenter': 'アップデートセンター',
  'header.language': '言語',
  'header.initializeSession': 'ログイン',

  'header.updateCenterTitle': 'アップデートセンター',
  'header.updateCenterDesc': 'Control と Agent のリリースを自動確認します。',
  'header.checking': '確認中',
  'header.updateAvailable': '更新があります',
  'header.upToDate': '最新です',
  'header.control': 'Control',
  'header.current': '現在',
  'header.latest': '最新',
  'header.published': '公開日',
  'header.agent': 'Agent',
  'header.nodesOutdated': ({ count }) => `${count ?? 0} 台が更新待ち`,
  'header.nodesUpToDate': 'ノードは最新です',
  'header.nodesManageUpdates': ({ count }) => `ノード ${count ?? 0} 台 · 「ノード」から単体/一括更新できます`,
  'header.manifestSource': 'Manifest ソース',
  'header.compatibility': '互換性',
  'header.failedCheckUpdates': '更新確認に失敗しました。「今すぐ確認」で再試行してください。',
  'header.checkNow': '今すぐ確認',
  'header.openNodes': 'ノードを開く',
  'header.updaterNotConfigured': 'アップデーターが未設定です',
  'header.alreadyUpToDate': 'すでに最新です',
  'header.triggerControlUpdate': 'Control 更新を実行',
  'header.updateControl': 'Control を更新',
  'header.oneClickWatchtowerHint': 'ワンクリック更新には Watchtower HTTP API が必要です。alloy-control で ALLOY_UPDATE_WATCHTOWER_URL を設定してください。',
  'header.controlReleaseNotes': 'Control リリースノート',
  'header.catalogFresh': 'カタログ最新',
  'header.catalogStale': 'カタログが古い可能性',
  'header.catalogUnknown': 'カタログ時刻不明',
  'header.lastCatalogSync': '最終同期',
  'header.roleAdministrator': '管理者',
  'header.roleUser': 'ユーザー',
  'header.diagnostics': '診断',
  'header.logout': 'ログアウト',
  'header.updateTriggered': '更新を開始しました',
  'header.watchtowerUpdateRequested': 'Watchtower 更新をリクエストしました。',
  'header.updateFailed': '更新に失敗しました',

  'nav.primary': 'メインナビゲーション',
  'nav.goToInstances': 'インスタンスへ移動',
  'tab.instances': 'インスタンス',
  'tab.downloads': 'ダウンロード',
  'tab.files': 'ファイル',
  'tab.nodes': 'ノード',
  'tab.frp': 'トンネル',
  'tab.settings': '設定',
  'sidebar.collapse': 'サイドバーを折りたたむ',
  'sidebar.expand': 'サイドバーを展開',

  'mobile.menu': 'メニュー',
  'mobile.theme': ({ mode }) => `テーマ：${mode ?? ''}`,
  'theme.system': 'システム',
  'theme.light': 'ライト',
  'theme.dark': 'ダーク',
  'mobile.signIn': 'ログイン',

  'auth.workspaceLocked': 'ワークスペースはロックされています。',
  'auth.signInPrompt': 'ログインするとインスタンス管理、ファイル参照、ノード表示が可能になります。',
  'auth.initializeSession': 'セッション開始',

  'banner.backendOffline': 'バックエンドがオフラインです',
  'banner.agentUnreachable': 'Agent に接続できません',
  'banner.lastOk': ({ value }) => `最終正常時刻：${value ?? '-'}。`,
  'banner.retry': '再試行',
  'banner.readOnlyMode': '読み取り専用モード',
  'banner.readOnlyMessage': 'インスタンス操作とファイル書き込みは無効です。',
  'banner.details': '詳細',
  'banner.readOnlyFilesystem': '読み取り専用ファイルシステム',
  'banner.enableFsWrite': 'ALLOY_FS_WRITE_ENABLED=true で書き込みを有効化できます。',
  'banner.copyEnvVar': '環境変数をコピー',

  'toast.copied': 'コピーしました',
  'toast.fsWriteEnvCopied': 'ALLOY_FS_WRITE_ENABLED=true',
}

const ko: Partial<Record<I18nKey, MessageValue>> = {
  'app.controlPlane': '컨트롤 플레인',
  'status.backend': '백엔드',
  'status.agent': 'Agent',
  'status.offline': '오프라인',
  'status.ok': '정상',

  'header.openMenu': '메뉴 열기',
  'header.environment': '환경',
  'header.readOnlyMode': '읽기 전용 모드',
  'header.readOnlyBadge': '읽기 전용',
  'header.updatesAvailable': '업데이트 있음',
  'header.updateCenter': '업데이트 센터',
  'header.language': '언어',
  'header.initializeSession': '로그인',

  'header.updateCenterTitle': '업데이트 센터',
  'header.updateCenterDesc': 'Control 및 Agent 릴리스를 자동으로 확인합니다.',
  'header.checking': '확인 중',
  'header.updateAvailable': '업데이트 가능',
  'header.upToDate': '최신 상태',
  'header.control': 'Control',
  'header.current': '현재',
  'header.latest': '최신',
  'header.published': '게시일',
  'header.agent': 'Agent',
  'header.nodesOutdated': ({ count }) => `${count ?? 0}개 업데이트 필요`,
  'header.nodesUpToDate': '노드가 최신 상태입니다',
  'header.nodesManageUpdates': ({ count }) => `노드 ${count ?? 0}개 · 노드 탭에서 단일/일괄 업데이트 관리`,
  'header.manifestSource': '매니페스트 소스',
  'header.compatibility': '호환성',
  'header.failedCheckUpdates': '업데이트 확인에 실패했습니다. 지금 확인으로 다시 시도하세요.',
  'header.checkNow': '지금 확인',
  'header.openNodes': '노드 열기',
  'header.updaterNotConfigured': '업데이터가 구성되지 않았습니다',
  'header.alreadyUpToDate': '이미 최신입니다',
  'header.triggerControlUpdate': 'Control 업데이트 실행',
  'header.updateControl': 'Control 업데이트',
  'header.oneClickWatchtowerHint':
    '원클릭 업데이트에는 Watchtower HTTP API가 필요합니다. alloy-control에 ALLOY_UPDATE_WATCHTOWER_URL을 설정하세요.',
  'header.controlReleaseNotes': 'Control 릴리스 노트',
  'header.catalogFresh': '카탈로그 최신',
  'header.catalogStale': '카탈로그 오래됨',
  'header.catalogUnknown': '카탈로그 시간 알 수 없음',
  'header.lastCatalogSync': '카탈로그 마지막 동기화',
  'header.roleAdministrator': '관리자',
  'header.roleUser': '사용자',
  'header.diagnostics': '진단',
  'header.logout': '로그아웃',
  'header.updateTriggered': '업데이트를 시작했습니다',
  'header.watchtowerUpdateRequested': 'Watchtower 업데이트를 요청했습니다.',
  'header.updateFailed': '업데이트 실패',

  'nav.primary': '주 탐색',
  'nav.goToInstances': '인스턴스로 이동',
  'tab.instances': '인스턴스',
  'tab.downloads': '다운로드',
  'tab.files': '파일',
  'tab.nodes': '노드',
  'tab.frp': '터널',
  'tab.settings': '설정',
  'sidebar.collapse': '사이드바 접기',
  'sidebar.expand': '사이드바 펼치기',

  'mobile.menu': '메뉴',
  'mobile.theme': ({ mode }) => `테마: ${mode ?? ''}`,
  'theme.system': '시스템',
  'theme.light': '라이트',
  'theme.dark': '다크',
  'mobile.signIn': '로그인',

  'auth.workspaceLocked': '워크스페이스가 잠겨 있습니다.',
  'auth.signInPrompt': '로그인하면 인스턴스 관리, 파일 탐색, 노드 보기가 가능합니다.',
  'auth.initializeSession': '세션 시작',

  'banner.backendOffline': '백엔드 오프라인',
  'banner.agentUnreachable': 'Agent에 연결할 수 없습니다',
  'banner.lastOk': ({ value }) => `마지막 정상 시각: ${value ?? '-'}`,
  'banner.retry': '다시 시도',
  'banner.readOnlyMode': '읽기 전용 모드',
  'banner.readOnlyMessage': '인스턴스 작업과 파일 쓰기가 비활성화되었습니다.',
  'banner.details': '세부 정보',
  'banner.readOnlyFilesystem': '읽기 전용 파일 시스템',
  'banner.enableFsWrite': 'ALLOY_FS_WRITE_ENABLED=true 로 쓰기를 활성화할 수 있습니다.',
  'banner.copyEnvVar': '환경 변수 복사',

  'toast.copied': '복사됨',
  'toast.fsWriteEnvCopied': 'ALLOY_FS_WRITE_ENABLED=true',
}

const catalog: Record<AppLocale, Partial<Record<I18nKey, MessageValue>>> = {
  en,
  'zh-CN': zhCN,
  'zh-TW': zhTW,
  ja,
  ko,
}

export function translate(locale: AppLocale, key: I18nKey, params: I18nParams = {}): string {
  const value = catalog[locale][key] ?? en[key]
  if (typeof value === 'function') return value(params)
  return value
}

const basePhraseCatalog: Record<Exclude<AppLocale, 'en'>, Record<string, string>> = {
  'zh-CN': {},
  'zh-TW': {},
  ja: {},
  ko: {},
}

for (const key of Object.keys(en) as I18nKey[]) {
  const source = en[key]
  if (typeof source !== 'string') continue

  for (const locale of ['zh-CN', 'zh-TW', 'ja', 'ko'] as const) {
    const translated = catalog[locale][key]
    if (typeof translated !== 'string') continue
    if (translated === source) continue
    basePhraseCatalog[locale][source] = translated
  }
}

const manualLoosePhraseCatalog: Record<Exclude<AppLocale, 'en'>, Record<string, string>> = {
  'zh-CN': {
    Account: '账户',
    Agent: 'Agent',
    All: '全部',
    Actions: '操作',
    Advanced: '高级',
    Administrator: '管理员',
    Available: '可用',
    Back: '返回',
    Breadcrumb: '面包屑导航',
    Control: 'Control',
    Copy: '复制',
    Create: '创建',
    Current: '当前',
    Dark: '深色',
    Details: '详情',
    Enable: '启用',
    Enter: '回车',
    Escape: 'Esc',
    Exit: '退出',
    Extract: '解压',
    Failed: '失败',
    'Failed:': '失败：',
    Forward: '前进',
    Hint: '提示',
    Import: '导入',
    Imported: '已导入',
    Light: '浅色',
    Path: '路径',
    Port: '端口',
    Public: '公网',
    Run: '运行',
    Running: '运行中',
    Save: '保存',
    Status: '状态',
    Tail: '尾部',
    Token: '令牌',
    'Token:': '令牌：',
    Value: '值',
    Vanilla: '默认',
    Warm: '预热',
    '(and auto remote port if needed).': '（必要时自动分配远程端口）。',
    '(leave blank to keep)': '（留空则保持不变）',
    '(none)': '（无）',
    '(not set)': '（未设置）',
    '0 for auto': '0 表示自动',
    '0 matches': '0 条匹配',
    '1=small, 2=medium, 3=large.': '1=小，2=中，3=大。',
    '504 gateway time-out': '504 网关超时',
    '504 gateway timeout': '504 网关超时',
    'Accept the Minecraft EULA to start.': '接受《我的世界》EULA 后即可启动。',
    'Agent unreachable': 'Agent 不可达',
    'All cached versions': '所有缓存版本',
    'All statuses': '全部状态',
    'All templates': '全部模板',
    'Alloc ports:': '分配端口：',
    'Allocatable ports': '可分配端口',
    'Already here': '已在当前位置',
    'Already up to date': '已是最新',
    'Applied on next start. Use 0 to auto-assign a free port.': '将在下次启动时生效。使用 0 自动分配空闲端口。',
    'Auth (UDP)': '认证（UDP）',
    'Auth port': '认证端口',
    'Auto 2FA disabled': '自动 2FA 已禁用',
    'Auto 2FA enabled': '自动 2FA 已启用',
    'Auto checks control and agent releases.': '自动检查 Control 与 Agent 发布版本。',
    'Auto schedule': '自动计划',
    'Backend offline': '后端离线',
    'Cached versions': '缓存版本',
    'Changes apply on next start.': '改动将在下次启动时生效。',
    'Changing memory affects JVM heap; take care on low-RAM hosts.': '修改内存会影响 JVM 堆；低内存主机请谨慎。',
    'Changing port affects client connection address.': '修改端口会影响客户端连接地址。',
    'Check now': '立即检查',
    'Clear finished jobs': '清除已完成任务',
    'Clear history': '清除历史',
    'Clear maFile': '清除 maFile',
    'Click to copy connection address': '点击复制连接地址',
    'Client connection port. Use 0 to auto-assign.': '客户端连接端口。使用 0 自动分配。',
    'Cluster name': '集群名称',
    'Cluster token': '集群令牌',
    'Collapse sidebar': '收起侧边栏',
    'Compose copied.': 'Compose 配置已复制。',
    'Config (optional)': '配置（可选）',
    'Control account': '控制账号',
    'Control account credentials updated': '控制账号凭据已更新',
    'Control release notes': 'Control 发布说明',
    'Control WS URL': 'Control WS URL',
    'Could not read maFile': '无法读取 maFile',
    'Creates a one-time token and a docker-compose snippet for an agent to connect back.':
      '创建一次性令牌和 docker-compose 片段，供 Agent 回连。',
    'CurseForge API key': 'CurseForge API 密钥',
    'CurseForge API key cleared': 'CurseForge API 密钥已清除',
    'CurseForge API key not set': 'CurseForge API 密钥未设置',
    'CurseForge API key updated': 'CurseForge API 密钥已更新',
    'Data root': '数据根目录',
    'Default agent': '默认 Agent',
    'Detected format:': '检测到格式：',
    'Display name (optional)': '显示名称（可选）',
    'Does not match.': '不匹配。',
    'DST default key cleared': '饥荒联机版默认密钥已清除',
    'DST default key updated': '饥荒联机版默认密钥已更新',
    'DST default Klei key': '饥荒联机版默认 Klei 密钥',
    'Empty directory': '空目录',
    'Enable RCON': '启用 RCON',
    'Enable remote console access.': '启用远程控制台访问。',
    'Enable with ALLOY_FS_WRITE_ENABLED=true.': '通过 ALLOY_FS_WRITE_ENABLED=true 启用。',
    'Enter both Steam username and password, or clear both.': '请输入 Steam 用户名和密码，或同时清空。',
    'Enter latest Steam Guard code or enable Auto 2FA.': '请输入最新 Steam Guard 代码，或启用自动 2FA。',
    'Estimated size': '预估大小',
    'EULA accepted': '已接受 EULA',
    'Expand sidebar': '展开侧边栏',
    'Experimental (latest)': '实验版（最新）',
    'Factorio (Vanilla)': '异星工厂',
    'Filter by status': '按状态筛选',
    'Filter by template': '按模板筛选',
    'Free space': '可用空间',
    'Game connection port. Use 0 to auto-assign.': '游戏连接端口。使用 0 自动分配。',
    'Go (Enter)': '前往（回车）',
    'Go to line': '跳转到行',
    'Hide advanced': '隐藏高级项',
    'Hide key': '隐藏密钥',
    'Hide password': '隐藏密码',
    'Hide token': '隐藏令牌',
    'Import from URL': '从 URL 导入',
    'Import maFile': '导入 maFile',
    'Include timestamp when copying': '复制时包含时间戳',
    'Increase font size': '增大字体',
    'Invalid request': '无效请求',
    'Jump to bottom': '跳转到底部',
    'just now': '刚刚',
    'Last result': '最后结果',
    'Last seen': '最后在线',
    'Leave blank for auto-assign.': '留空则自动分配。',
    'Leave blank to keep existing; set a value to change.': '留空保持现值；填写则修改。',
    'Line #': '行号 #',
    'Live Progress': '实时进度',
    'Loading templates...': '正在加载模板...',
    'Master (UDP)': '主端口（UDP）',
    'Max players': '最大玩家数',
    'Maximum concurrent players allowed to join.': '允许同时加入的最大玩家数。',
    'Memory (MB)': '内存（MB）',
    'Memory (MiB)': '内存（MiB）',
    'Minecraft (Vanilla)': '我的世界',
    'Minecraft EULA': '我的世界 EULA',
    'Missing field': '缺少字段',
    'Move down': '下移',
    'Move up': '上移',
    'Not cached': '未缓存',
    'Not found': '未找到',
    'Not set': '未设置',
    'Permission denied': '权限不足',
    'Preview not supported': '不支持预览',
    'Primary navigation': '主导航',
    'Process logs': '进程日志',
    'Refresh and retry.': '刷新后重试。',
    'Retry after reconnecting.': '重连后重试。',
    'Retry the request.': '请重试请求。',
    'Select all': '全选',
    'Select outdated': '选择过期项',
    'Show key': '显示密钥',
    'Show or hide advanced fields': '显示或隐藏高级字段',
    'Something went wrong': '发生错误',
    'SteamCMD credentials': 'SteamCMD 凭据',
    'SteamCMD credentials cleared': 'SteamCMD 凭据已清除',
    'SteamCMD credentials verified and saved': 'SteamCMD 凭据已验证并保存',
    'Terraria (Vanilla)': '泰拉瑞亚',
    'Timed out': '请求超时',
    'type = tcp': '类型 = tcp',
    'Up to date': '已是最新',
    'Updater configured': '更新器已配置',
    'Updater not configured': '更新器未配置',
    'Updater status unavailable': '更新器状态不可用',
    'Use control default routing': '使用控制端默认路由',
    'Vanilla / Modrinth / Import / CurseForge': 'Modrinth / 导入 / CurseForge',
    'Workspace is locked.': '工作区已锁定。',
    'Wrap: off': '自动换行：关',
    'Wrap: on': '自动换行：开',
    '7 Days to Die': '七日杀',
    '7 Days to Die (Vanilla)': '七日杀',
    '7 Days to Die: Dedicated': '七日杀',
    '502 bad gateway': '502 网关错误',
    'Alloy DST server': 'Alloy 饥荒联机版服务器',
    'Alloy Factorio server': 'Alloy 异星工厂服务器',
    'Alloy Palworld server': 'Alloy 幻兽帕鲁服务器',
    'bad gateway': '网关错误',
    'Bad Gateway (502). The web proxy could not reach the backend. Refresh the page and retry.':
      '网关错误（502）：Web 代理无法连接后端。请刷新页面后重试。',
    'Control Plane': '控制台',
    'Core Keeper': '核心守护者',
    'Core Keeper (Vanilla)': '核心守护者',
    'Core Keeper: Dedicated': '核心守护者',
    CurseForge: 'CurseForge',
    "Don't Starve Together": '饥荒联机版',
    "Don't Starve Together (Vanilla)": '饥荒联机版',
    'dst:vanilla@': 'dst:@',
    'e.g. 1.2.3.4 or frp.example.com': '例如 1.2.3.4 或 frp.example.com',
    'e.g. friends-survival': '例如 friends-survival',
    'e.g. my-frp': '例如 my-frp',
    'factorio:vanilla@': 'factorio:@',
    'Factorio: Vanilla': '异星工厂',
    'installing 7 days to die server via steamcmd…': '正在通过 SteamCMD 安装七日杀服务器…',
    'installing core keeper server via steamcmd…': '正在通过 SteamCMD 安装核心守护者服务器…',
    'installing dst dedicated server via steamcmd…': '正在通过 SteamCMD 安装饥荒联机版专用服务器…',
    'installing palworld server via steamcmd…': '正在通过 SteamCMD 安装幻兽帕鲁服务器…',
    'installing sons of the forest server via steamcmd…': '正在通过 SteamCMD 安装森林之子服务器…',
    'installing the forest server via steamcmd…': '正在通过 SteamCMD 安装森林服务器…',
    'minecraft:vanilla@': 'minecraft:@',
    'Optional. For example: 20000-20100,21000. Used when remote_port is auto.':
      '可选。例如：20000-20100,21000。当 remote_port 为 auto 时使用。',
    'Optional. Paste an FRP config to expose this instance (auto-detects INI/TOML/YAML/JSON).':
      '可选。粘贴隧道配置以公开此实例（自动检测 INI/TOML/YAML/JSON）。',
    DST: '饥荒联机版',
    Minecraft: '我的世界',
    Terraria: '泰拉瑞亚',
    Factorio: '异星工厂',
    Palworld: '幻兽帕鲁',
    'Palworld (Vanilla)': '幻兽帕鲁',
    'Palworld: Vanilla': '幻兽帕鲁',
    'palworld:vanilla@': 'palworld:@',
    'Sets JVM heap size. Too low can crash; too high can starve the host.':
      '设置 JVM 堆大小。过低可能崩溃，过高会挤占宿主机内存。',
    'Sons of the Forest': '森林之子',
    'Sons of the Forest (Vanilla)': '森林之子',
    'Sons of the Forest: Dedicated': '森林之子',
    'Terraria: Vanilla': '泰拉瑞亚',
    'terraria:vanilla@': 'terraria:@',
    'The Forest': '森林',
    'The Forest (Vanilla)': '森林',
    'The Forest: Dedicated': '森林',
    'verifying 7 days to die install files…': '正在验证七日杀安装文件…',
    'verifying core keeper install files…': '正在验证核心守护者安装文件…',
    'verifying dst install files…': '正在验证饥荒联机版安装文件…',
    'verifying palworld install files…': '正在验证幻兽帕鲁安装文件…',
    'verifying sons of the forest install files…': '正在验证森林之子安装文件…',
    'verifying the forest install files…': '正在验证森林安装文件…',
    FRP: '隧道',
    Tunnels: '隧道',
    Tunnel: '隧道',
    'Tunnel nodes': '隧道节点',
    'Add tunnel node': '新增隧道节点',
    'No tunnel nodes': '暂无隧道节点',
    'Delete tunnel node': '删除隧道节点',
    'Edit tunnel node': '编辑隧道节点',
    'Failed to load tunnel nodes': '加载隧道节点失败',
    'Select a tunnel node.': '请选择一个隧道节点。',
    'Paste tunnel config': '粘贴隧道配置',
    'Paste tunnel config.': '请粘贴隧道配置。',
    'Paste tunnel config (INI/TOML/YAML/JSON)': '粘贴隧道配置（INI/TOML/YAML/JSON）',
    'Paste tunnel config (auto: INI/TOML/YAML/JSON)': '粘贴隧道配置（自动：INI/TOML/YAML/JSON）',
    'Paste tunnel config to set/replace (auto: INI/TOML/YAML/JSON)': '粘贴隧道配置以设置/替换（自动：INI/TOML/YAML/JSON）',
    'Paste tunnel config or disable tunnels.': '请粘贴隧道配置，或关闭隧道功能。',
    'Public (Tunnels)': '公网（隧道）',
    'Copy public endpoint (Tunnel)': '复制公网入口（隧道）',
    'Open Tunnels tab to add one.': '前往“隧道”标签页添加。',
    'Store tunnel server info and optional config. Config format is auto-detected (INI/TOML/YAML/JSON).':
      '保存隧道服务器信息和可选配置。配置格式会自动检测（INI/TOML/YAML/JSON）。',
    'Minecraft server bundles are version-managed (not “updated”). Cache the version you plan to use.':
      '我的世界服务端包按版本管理（不是“更新”）。请缓存你计划使用的版本。',
    'Terraria server bundles are version-managed. Choose a build number and cache it.':
      '泰拉瑞亚服务端包按版本管理。选择构建号并缓存。',
    'DST dedicated server is installed via SteamCMD and cached per install target.':
      '饥荒联机版专用服务器通过 SteamCMD 安装，并按安装目标缓存。',
    'Don\'t Starve Together dedicated server is installed via SteamCMD and cached per install target.':
      '饥荒联机版专用服务器通过 SteamCMD 安装，并按安装目标缓存。',
    'Palworld dedicated server is installed via SteamCMD and cached per install target.':
      '幻兽帕鲁专用服务器通过 SteamCMD 安装，并按安装目标缓存。',
    'Factorio headless packages are version-managed. Choose channel or version and cache it.':
      '异星工厂无头包按版本管理。选择频道或版本并缓存。',
    'Paste a .zip URL containing a single DST cluster (Cluster_1/).':
      '粘贴包含单个饥荒联机版集群（Cluster_1/）的 .zip URL。',
    'Tunnel server': '隧道服务器',
    'Tunnel token': '隧道令牌',
  },
  'zh-TW': {
    Account: '帳戶',
    Actions: '操作',
    Advanced: '進階',
    Administrator: '管理員',
    Agent: 'Agent',
    Available: '可用',
    Back: '返回',
    Breadcrumb: '麵包屑導覽',
    Control: 'Control',
    Create: '建立',
    Current: '目前',
    Dark: '深色',
    Details: '詳情',
    Enable: '啟用',
    Enter: 'Enter',
    Escape: 'Esc',
    Exit: '退出',
    Failed: '失敗',
    Forward: '前進',
    Hint: '提示',
    Import: '匯入',
    Imported: '已匯入',
    Light: '淺色',
    Path: '路徑',
    Port: '連接埠',
    Public: '公開',
    Run: '執行',
    Running: '執行中',
    Save: '儲存',
    Status: '狀態',
    Tail: '尾端',
    Token: '權杖',
    Value: '值',
    Vanilla: '預設',
    Warm: '預熱',
    '(and auto remote port if needed).': '（必要時自動分配遠端埠）。',
    '(leave blank to keep)': '（留空則保持不變）',
    '(none)': '（無）',
    '(not set)': '（未設定）',
    '0 for auto': '0 表示自動',
    '0 matches': '0 筆匹配',
    '1=small, 2=medium, 3=large.': '1=小，2=中，3=大。',
    '504 gateway timeout': '504 閘道逾時',
    'Accept the Minecraft EULA to start.': '接受《我的世界》EULA 後即可啟動。',
    'All cached versions': '所有快取版本',
    'All statuses': '全部狀態',
    'All templates': '全部範本',
    'Auto 2FA disabled': '自動 2FA 已停用',
    'Auto 2FA enabled': '自動 2FA 已啟用',
    'Backend offline': '後端離線',
    'Check now': '立即檢查',
    'Collapse sidebar': '收合側邊欄',
    'Config (optional)': '設定（可選）',
    'Could not read maFile': '無法讀取 maFile',
    'Data root': '資料根目錄',
    'Default agent': '預設 Agent',
    'Display name (optional)': '顯示名稱（可選）',
    'Empty directory': '空目錄',
    'Enable RCON': '啟用 RCON',
    'Expand sidebar': '展開側邊欄',
    'Factorio (Vanilla)': '異星工廠',
    'Filter by status': '依狀態篩選',
    'Filter by template': '依範本篩選',
    'Free space': '可用空間',
    'Go (Enter)': '前往（Enter）',
    'Hide advanced': '隱藏進階項',
    'Import from URL': '從 URL 匯入',
    'Import maFile': '匯入 maFile',
    'Invalid request': '無效請求',
    'Jump to bottom': '跳到最底部',
    'just now': '剛剛',
    'Last result': '最後結果',
    'Last seen': '最後在線',
    'Leave blank for auto-assign.': '留空則自動分配。',
    'Loading templates...': '正在載入範本...',
    'Memory (MB)': '記憶體（MB）',
    'Memory (MiB)': '記憶體（MiB）',
    'Minecraft (Vanilla)': '我的世界',
    'Missing field': '缺少欄位',
    'Not found': '找不到',
    'Permission denied': '權限不足',
    'Preview not supported': '不支援預覽',
    'Refresh and retry.': '重新整理後再試。',
    'Retry the request.': '請重試此請求。',
    'SteamCMD credentials': 'SteamCMD 憑證',
    'Terraria (Vanilla)': '泰拉瑞亞',
    'Timed out': '逾時',
    'Up to date': '已是最新',
    'Workspace is locked.': '工作區已鎖定。',
    'Vanilla / Modrinth / Import / CurseForge': 'Modrinth / 匯入 / CurseForge',
    '7 Days to Die': '七日殺',
    '7 Days to Die (Vanilla)': '七日殺',
    '7 Days to Die: Dedicated': '七日殺',
    '502 bad gateway': '502 閘道錯誤',
    'Alloy DST server': 'Alloy 饑荒聯機版伺服器',
    'Alloy Factorio server': 'Alloy 異星工廠伺服器',
    'Alloy Palworld server': 'Alloy 幻獸帕魯伺服器',
    'bad gateway': '閘道錯誤',
    'Control Plane': '控制台',
    'Core Keeper': '核心守護者',
    'Core Keeper (Vanilla)': '核心守護者',
    'Core Keeper: Dedicated': '核心守護者',
    CurseForge: 'CurseForge',
    "Don't Starve Together": '饑荒聯機版',
    "Don't Starve Together (Vanilla)": '饑荒聯機版',
    'dst:vanilla@': 'dst:@',
    'e.g. my-frp': '例如 my-frp',
    'factorio:vanilla@': 'factorio:@',
    'Factorio: Vanilla': '異星工廠',
    'installing 7 days to die server via steamcmd…': '正在透過 SteamCMD 安裝七日殺伺服器…',
    'installing core keeper server via steamcmd…': '正在透過 SteamCMD 安裝核心守護者伺服器…',
    'installing dst dedicated server via steamcmd…': '正在透過 SteamCMD 安裝饑荒聯機版專用伺服器…',
    'installing palworld server via steamcmd…': '正在透過 SteamCMD 安裝幻獸帕魯伺服器…',
    'installing sons of the forest server via steamcmd…': '正在透過 SteamCMD 安裝森林之子伺服器…',
    'installing the forest server via steamcmd…': '正在透過 SteamCMD 安裝森林伺服器…',
    'minecraft:vanilla@': 'minecraft:@',
    'Optional. For example: 20000-20100,21000. Used when remote_port is auto.':
      '可選。例如：20000-20100,21000。當 remote_port 為 auto 時使用。',
    'Optional. Paste an FRP config to expose this instance (auto-detects INI/TOML/YAML/JSON).':
      '可選。貼上隧道設定以公開此實例（自動偵測 INI/TOML/YAML/JSON）。',
    DST: '饑荒聯機版',
    Minecraft: '我的世界',
    Terraria: '泰拉瑞亞',
    Factorio: '異星工廠',
    Palworld: '幻獸帕魯',
    'Palworld (Vanilla)': '幻獸帕魯',
    'Palworld: Vanilla': '幻獸帕魯',
    'palworld:vanilla@': 'palworld:@',
    'Sets JVM heap size. Too low can crash; too high can starve the host.':
      '設定 JVM Heap 大小。太低可能崩潰，太高會擠壓宿主機記憶體。',
    'Sons of the Forest': '森林之子',
    'Sons of the Forest (Vanilla)': '森林之子',
    'Sons of the Forest: Dedicated': '森林之子',
    'Terraria: Vanilla': '泰拉瑞亞',
    'terraria:vanilla@': 'terraria:@',
    'The Forest': '森林',
    'The Forest (Vanilla)': '森林',
    'The Forest: Dedicated': '森林',
    'verifying 7 days to die install files…': '正在驗證七日殺安裝檔案…',
    'verifying core keeper install files…': '正在驗證核心守護者安裝檔案…',
    'verifying dst install files…': '正在驗證饑荒聯機版安裝檔案…',
    'verifying palworld install files…': '正在驗證幻獸帕魯安裝檔案…',
    'verifying sons of the forest install files…': '正在驗證森林之子安裝檔案…',
    'verifying the forest install files…': '正在驗證森林安裝檔案…',
    FRP: '隧道',
    Tunnels: '隧道',
    Tunnel: '隧道',
    'Tunnel nodes': '隧道節點',
    'Add tunnel node': '新增隧道節點',
    'No tunnel nodes': '暫無隧道節點',
    'Delete tunnel node': '刪除隧道節點',
    'Edit tunnel node': '編輯隧道節點',
    'Failed to load tunnel nodes': '載入隧道節點失敗',
    'Select a tunnel node.': '請選擇一個隧道節點。',
    'Paste tunnel config': '貼上隧道設定',
    'Paste tunnel config.': '請貼上隧道設定。',
    'Paste tunnel config (INI/TOML/YAML/JSON)': '貼上隧道設定（INI/TOML/YAML/JSON）',
    'Paste tunnel config (auto: INI/TOML/YAML/JSON)': '貼上隧道設定（自動：INI/TOML/YAML/JSON）',
    'Paste tunnel config to set/replace (auto: INI/TOML/YAML/JSON)': '貼上隧道設定以設置/取代（自動：INI/TOML/YAML/JSON）',
    'Paste tunnel config or disable tunnels.': '請貼上隧道設定，或停用隧道功能。',
    'Public (Tunnels)': '公開（隧道）',
    'Copy public endpoint (Tunnel)': '複製公開入口（隧道）',
    'Open Tunnels tab to add one.': '前往「隧道」分頁新增。',
    'Store tunnel server info and optional config. Config format is auto-detected (INI/TOML/YAML/JSON).':
      '儲存隧道伺服器資訊與可選設定。設定格式會自動偵測（INI/TOML/YAML/JSON）。',
    'DST default key cleared': '饑荒聯機版預設金鑰已清除',
    'DST default key updated': '饑荒聯機版預設金鑰已更新',
    'DST default Klei key': '饑荒聯機版預設 Klei 金鑰',
    'Minecraft EULA': '我的世界 EULA',
    'Minecraft server bundles are version-managed (not “updated”). Cache the version you plan to use.':
      '我的世界伺服器套件採版本管理（不是「更新」）。請快取你打算使用的版本。',
    'Terraria server bundles are version-managed. Choose a build number and cache it.':
      '泰拉瑞亞伺服器套件採版本管理。請選擇版本號並快取。',
    'DST dedicated server is installed via SteamCMD and cached per install target.':
      '饑荒聯機版專用伺服器透過 SteamCMD 安裝，並依安裝目標快取。',
    'Don\'t Starve Together dedicated server is installed via SteamCMD and cached per install target.':
      '饑荒聯機版專用伺服器透過 SteamCMD 安裝，並依安裝目標快取。',
    'Palworld dedicated server is installed via SteamCMD and cached per install target.':
      '幻獸帕魯專用伺服器透過 SteamCMD 安裝，並依安裝目標快取。',
    'Factorio headless packages are version-managed. Choose channel or version and cache it.':
      '異星工廠無頭套件採版本管理。請選擇頻道或版本並快取。',
    'Paste a .zip URL containing a single DST cluster (Cluster_1/).':
      '貼上包含單一饑荒聯機版叢集（Cluster_1/）的 .zip URL。',
    'Tunnel server': '隧道伺服器',
    'Tunnel token': '隧道權杖',
  },
  ja: {
    FRP: 'トンネル',
    Tunnels: 'トンネル',
    Tunnel: 'トンネル',
    'Tunnel nodes': 'トンネルノード',
    'Add tunnel node': 'トンネルノードを追加',
    'No tunnel nodes': 'トンネルノードがありません',
    'Delete tunnel node': 'トンネルノードを削除',
    'Edit tunnel node': 'トンネルノードを編集',
    'Failed to load tunnel nodes': 'トンネルノードの読み込みに失敗',
    'Select a tunnel node.': 'トンネルノードを選択してください。',
    'Paste tunnel config': 'トンネル設定を貼り付け',
    'Paste tunnel config.': 'トンネル設定を貼り付けてください。',
    'Paste tunnel config (INI/TOML/YAML/JSON)': 'トンネル設定（INI/TOML/YAML/JSON）を貼り付け',
    'Paste tunnel config (auto: INI/TOML/YAML/JSON)': 'トンネル設定を貼り付け（自動: INI/TOML/YAML/JSON）',
    'Paste tunnel config to set/replace (auto: INI/TOML/YAML/JSON)': 'トンネル設定を貼り付けて設定/置換（自動: INI/TOML/YAML/JSON）',
    'Paste tunnel config or disable tunnels.': 'トンネル設定を貼り付けるか、トンネルを無効にしてください。',
    'Public (Tunnels)': '公開（トンネル）',
    'Copy public endpoint (Tunnel)': '公開エンドポイント（トンネル）をコピー',
    'Open Tunnels tab to add one.': '「トンネル」タブで追加してください。',
    'Store tunnel server info and optional config. Config format is auto-detected (INI/TOML/YAML/JSON).':
      'トンネルサーバー情報と任意設定を保存します。設定形式は自動検出されます（INI/TOML/YAML/JSON）。',
    'Tunnel server': 'トンネルサーバー',
    'Tunnel token': 'トンネルトークン',
  },
  ko: {
    Account: '계정',
    Actions: '작업',
    'Add node': '노드 추가',
    'Add to queue failed': '대기열 추가 실패',
    'Added to queue': '대기열에 추가됨',
    'Admin password': '관리자 비밀번호',
    Agent: 'Agent',
    'Agent current': '현재 Agent',
    'Agent log (tail)': 'Agent 로그 (tail)',
    'Agent offline': 'Agent 오프라인',
    'Agent target': 'Agent 대상',
    'Agent unreachable': 'Agent에 연결할 수 없음',
    'Agent up to date': 'Agent 최신 상태',
    'Agent update': 'Agent 업데이트',
    All: '전체',
    Available: '사용 가능',
    Cancel: '취소',
    Close: '닫기',
    Config: '설정',
    Copied: '복사됨',
    Copy: '복사',
    'Copy details': '세부 정보 복사',
    'Copy diagnostics JSON': '진단 JSON 복사',
    'Copy endpoint': '엔드포인트 복사',
    'Copy instance id': '인스턴스 ID 복사',
    'Copy JSON': 'JSON 복사',
    'Copy path': '경로 복사',
    'Copy request id': '요청 ID 복사',
    'Copy request-id': '요청 ID 복사',
    'Copy tail': 'tail 복사',
    'Copy token': '토큰 복사',
    Current: '현재',
    Delete: '삭제',
    'Delete failed': '삭제 실패',
    'Delete instance': '인스턴스 삭제',
    Description: '설명',
    Details: '세부 정보',
    Diagnostics: '진단',
    Download: '다운로드',
    Downloads: '다운로드',
    Edit: '편집',
    'Edit instance': '인스턴스 편집',
    Enabled: '활성화됨',
    Endpoint: '엔드포인트',
    Environment: '환경',
    Error: '오류',
    Failed: '실패',
    Files: '파일',
    'Go to Instances': '인스턴스로 이동',
    Health: '상태',
    Hint: '힌트',
    Idle: '유휴',
    Import: '가져오기',
    Imported: '가져옴',
    Install: '설치',
    Installing: '설치 중',
    Instances: '인스턴스',
    Language: '언어',
    Loading: '불러오는 중',
    Login: '로그인',
    Logout: '로그아웃',
    Name: '이름',
    New: '새로 만들기',
    Node: '노드',
    Nodes: '노드',
    Notes: '메모',
    Optional: '선택 사항',
    Password: '비밀번호',
    Path: '경로',
    Port: '포트',
    Public: '공개',
    Queue: '대기열',
    Ready: '준비됨',
    Refresh: '새로고침',
    Retry: '다시 시도',
    Running: '실행 중',
    Save: '저장',
    Saved: '저장됨',
    Search: '검색',
    Settings: '설정',
    Start: '시작',
    Started: '시작됨',
    Starting: '시작 중',
    State: '상태',
    Status: '상태',
    Stop: '중지',
    Stopped: '중지됨',
    Stopping: '중지 중',
    Success: '성공',
    System: '시스템',
    Target: '대상',
    Tasks: '작업',
    Template: '템플릿',
    Token: '토큰',
    Unknown: '알 수 없음',
    Update: '업데이트',
    Updated: '업데이트됨',
    Username: '사용자 이름',
    Value: '값',
    Version: '버전',
    Verify: '검증',
    Warm: '예열',
    '(leave blank to keep)': '(비워두면 유지)',
    '(none)': '(없음)',
    '(not set)': '(미설정)',
    '0 for auto': '자동은 0',
    '0 matches': '일치 항목 0개',
    '1=small, 2=medium, 3=large.': '1=작게, 2=중간, 3=크게',
    '502 bad gateway': '502 잘못된 게이트웨이',
    '504 gateway timeout': '504 게이트웨이 시간 초과',
    '7 Days to Die': '7 Days to Die',
    'Accept the Minecraft EULA to start.': '시작하려면 Minecraft EULA에 동의하세요.',
    'All cached versions': '모든 캐시 버전',
    'All statuses': '모든 상태',
    'All templates': '모든 템플릿',
    'Alloc ports:': '할당 포트:',
    'Allocatable ports': '할당 가능한 포트',
    'Already here': '이미 현재 위치입니다',
    'Already up to date': '이미 최신 상태입니다',
    'Auth (UDP)': '인증 (UDP)',
    'Auto checks control and agent releases.': 'Control 및 Agent 릴리스를 자동 확인합니다.',
    'Auto schedule': '자동 스케줄',
    'Backend offline': '백엔드 오프라인',
    'bad gateway': '잘못된 게이트웨이',
    'Bad Gateway (502). The web proxy could not reach the backend. Refresh the page and retry.':
      '잘못된 게이트웨이(502): 웹 프록시가 백엔드에 연결하지 못했습니다. 새로고침 후 다시 시도하세요.',
    'Cached versions': '캐시된 버전',
    'Changing memory affects JVM heap; take care on low-RAM hosts.': '메모리 변경은 JVM 힙에 영향을 줍니다. 저메모리 호스트에서는 주의하세요.',
    'Check now': '지금 확인',
    'Control account': 'Control 계정',
    'Control account credentials updated': 'Control 계정 자격 증명이 업데이트되었습니다',
    'Control Plane': '컨트롤 플레인',
    'Control release notes': 'Control 릴리스 노트',
    'Control WS URL': 'Control WS URL',
    'Core Keeper': 'Core Keeper',
    'Could not read maFile': 'maFile을 읽을 수 없습니다',
    'CurseForge API key': 'CurseForge API 키',
    'CurseForge API key cleared': 'CurseForge API 키를 지웠습니다',
    'CurseForge API key not set': 'CurseForge API 키가 설정되지 않았습니다',
    'CurseForge API key updated': 'CurseForge API 키가 업데이트되었습니다',
    'Data root': '데이터 루트',
    'Default agent': '기본 Agent',
    'Detected format:': '감지된 형식:',
    'Does not match.': '일치하지 않습니다.',
    "Don't Starve Together": "Don't Starve Together",
    "Don't Starve Together (Vanilla)": "Don't Starve Together (바닐라)",
    'dst:vanilla@': 'dst:바닐라@',
    'e.g. friends-survival': '예: friends-survival',
    'Enable RCON': 'RCON 활성화',
    'Enable remote console access.': '원격 콘솔 접근을 활성화합니다.',
    'Enable with ALLOY_FS_WRITE_ENABLED=true.': 'ALLOY_FS_WRITE_ENABLED=true 로 활성화하세요.',
    'EULA accepted': 'EULA 동의됨',
    'Factorio (Vanilla)': 'Factorio (바닐라)',
    'factorio:vanilla@': 'factorio:바닐라@',
    'Filter by status': '상태별 필터',
    'Go (Enter)': '이동 (Enter)',
    'Hide advanced': '고급 항목 숨기기',
    'I accept the': '동의합니다:',
    'Include timestamp when copying': '복사 시 타임스탬프 포함',
    'Invalid request': '잘못된 요청',
    'Jump to bottom': '맨 아래로 이동',
    'just now': '방금 전',
    'Last result': '마지막 결과',
    'Last seen': '마지막 확인',
    'Leave blank for auto-assign.': '자동 할당하려면 비워두세요.',
    'Leave blank to keep existing; set a value to change.': '기존 값을 유지하려면 비워두고, 변경하려면 값을 입력하세요.',
    'Live Progress': '실시간 진행',
    'Loading templates...': '템플릿 로딩 중...',
    'Manifest source': '매니페스트 소스',
    'Master (UDP)': '마스터 (UDP)',
    'Max players': '최대 플레이어 수',
    'Maximum concurrent players allowed to join.': '동시에 접속 가능한 최대 플레이어 수입니다.',
    'Memory (MB)': '메모리 (MB)',
    'Memory (MiB)': '메모리 (MiB)',
    'Minecraft (Vanilla)': 'Minecraft (바닐라)',
    'Minecraft EULA': 'Minecraft EULA',
    'minecraft:vanilla@': 'minecraft:바닐라@',
    'Missing field': '누락된 필드',
    'Move down': '아래로 이동',
    'Move up': '위로 이동',
    'Not cached': '캐시되지 않음',
    'Not found': '찾을 수 없음',
    'Not set': '설정되지 않음',
    'Palworld (Vanilla)': 'Palworld (바닐라)',
    'palworld:vanilla@': 'palworld:바닐라@',
    'Permission denied': '권한이 거부되었습니다',
    'Preview not supported': '미리보기를 지원하지 않습니다',
    'Primary navigation': '기본 탐색',
    'Process logs': '프로세스 로그',
    'Refresh and retry.': '새로고침 후 다시 시도하세요.',
    'Retry after reconnecting.': '다시 연결한 후 재시도하세요.',
    'Retry the request.': '요청을 다시 시도하세요.',
    'Select all': '모두 선택',
    'Select outdated': '업데이트 필요한 항목 선택',
    'Show key': '키 표시',
    'Show or hide advanced fields': '고급 필드 표시/숨기기',
    'Something went wrong': '문제가 발생했습니다',
    'Sons of the Forest': 'Sons of the Forest',
    'SteamCMD credentials': 'SteamCMD 자격 증명',
    'SteamCMD credentials cleared': 'SteamCMD 자격 증명을 지웠습니다',
    'SteamCMD credentials verified and saved': 'SteamCMD 자격 증명을 확인하고 저장했습니다',
    'Terraria (Vanilla)': 'Terraria (바닐라)',
    'terraria:vanilla@': 'terraria:바닐라@',
    'The Forest': 'The Forest',
    'Timed out': '시간 초과',
    'Up to date': '최신 상태',
    'Updater configured': '업데이터가 구성되었습니다',
    'Updater not configured': '업데이터가 구성되지 않았습니다',
    'Updater status unavailable': '업데이터 상태를 확인할 수 없습니다',
    'uploads/pack.zip or https://example.com/pack.zip': 'uploads/pack.zip 또는 https://example.com/pack.zip',
    'Use control default routing': 'Control 기본 라우팅 사용',
    'Workspace is locked.': '워크스페이스가 잠겨 있습니다.',
    'Wrap: off': '줄바꿈: 끔',
    'Wrap: on': '줄바꿈: 켬',
    FRP: '터널',
    Tunnels: '터널',
    Tunnel: '터널',
    'Tunnel nodes': '터널 노드',
    'Add tunnel node': '터널 노드 추가',
    'No tunnel nodes': '터널 노드가 없습니다',
    'Delete tunnel node': '터널 노드 삭제',
    'Edit tunnel node': '터널 노드 편집',
    'Failed to load tunnel nodes': '터널 노드를 불러오지 못했습니다',
    'Select a tunnel node.': '터널 노드를 선택하세요.',
    'Paste tunnel config': '터널 설정 붙여넣기',
    'Paste tunnel config.': '터널 설정을 붙여넣으세요.',
    'Paste tunnel config (INI/TOML/YAML/JSON)': '터널 설정 붙여넣기 (INI/TOML/YAML/JSON)',
    'Paste tunnel config (auto: INI/TOML/YAML/JSON)': '터널 설정 붙여넣기 (자동: INI/TOML/YAML/JSON)',
    'Paste tunnel config to set/replace (auto: INI/TOML/YAML/JSON)':
      '터널 설정 붙여넣기 (설정/교체, 자동: INI/TOML/YAML/JSON)',
    'Paste tunnel config or disable tunnels.': '터널 설정을 붙여넣거나 터널을 비활성화하세요.',
    'Public (Tunnels)': '공개 (터널)',
    'Copy public endpoint (Tunnel)': '공개 엔드포인트 복사 (터널)',
    'Open Tunnels tab to add one.': '추가하려면 터널 탭을 여세요.',
    'Store tunnel server info and optional config. Config format is auto-detected (INI/TOML/YAML/JSON).':
      '터널 서버 정보와 선택적 설정을 저장합니다. 설정 형식은 자동 감지됩니다 (INI/TOML/YAML/JSON).',
    'Tunnel server': '터널 서버',
    'Tunnel token': '터널 토큰',
  },
}

const AUTO_LOOSE_TRANSLATION_ENABLED: Record<Exclude<AppLocale, 'en'>, boolean> = {
  'zh-CN': false,
  'zh-TW': false,
  ja: false,
  ko: false,
}

function getSanitizedAutoCatalog(locale: Exclude<AppLocale, 'en'>): Record<string, string> {
  if (!AUTO_LOOSE_TRANSLATION_ENABLED[locale]) return {}
  const source = AUTO_PHRASE_TRANSLATIONS[locale] ?? {}
  const out: Record<string, string> = {}
  for (const [english, translated] of Object.entries(source)) {
    out[english] = sanitizeMachineTranslation(locale, english, translated)
  }
  return out
}

const loosePhraseCatalog: Record<Exclude<AppLocale, 'en'>, Record<string, string>> = {
  'zh-CN': {
    ...getSanitizedAutoCatalog('zh-CN'),
    ...basePhraseCatalog['zh-CN'],
    ...manualLoosePhraseCatalog['zh-CN'],
  },
  'zh-TW': {
    ...getSanitizedAutoCatalog('zh-TW'),
    ...basePhraseCatalog['zh-TW'],
    ...manualLoosePhraseCatalog['zh-TW'],
  },
  ja: {
    ...getSanitizedAutoCatalog('ja'),
    ...basePhraseCatalog.ja,
    ...manualLoosePhraseCatalog.ja,
  },
  ko: {
    ...getSanitizedAutoCatalog('ko'),
    ...basePhraseCatalog.ko,
    ...manualLoosePhraseCatalog.ko,
  },
}

const loosePhraseCatalogLower: Record<Exclude<AppLocale, 'en'>, Record<string, string>> = {
  'zh-CN': {},
  'zh-TW': {},
  ja: {},
  ko: {},
}

for (const locale of ['zh-CN', 'zh-TW', 'ja', 'ko'] as const) {
  const out: Record<string, string> = {}
  for (const [source, translated] of Object.entries(loosePhraseCatalog[locale])) {
    out[source.toLowerCase()] = translated
  }
  loosePhraseCatalogLower[locale] = out
}

const tokenCatalog: Record<Exclude<AppLocale, 'en'>, ReadonlyArray<readonly [string, string]>> = {
  'zh-CN': [
    ['tunnels', '隧道'],
    ['tunnel', '隧道'],
    ['frp', '隧道'],
    ['instances', '实例'],
    ['instance', '实例'],
    ['downloads', '下载'],
    ['download', '下载'],
    ['files', '文件'],
    ['file', '文件'],
    ['nodes', '节点'],
    ['node', '节点'],
    ['settings', '设置'],
    ['setting', '设置'],
    ['update', '更新'],
    ['updates', '更新'],
    ['add', '添加'],
    ['new', '新建'],
    ['no', '无'],
    ['load', '加载'],
    ['open', '打开'],
    ['public', '公网'],
    ['server', '服务器'],
    ['required', '必填'],
    ['running', '运行中'],
    ['stopped', '已停止'],
    ['failed', '失败'],
    ['error', '错误'],
    ['success', '成功'],
    ['save', '保存'],
    ['delete', '删除'],
    ['create', '创建'],
    ['edit', '编辑'],
    ['search', '搜索'],
    ['cache', '缓存'],
    ['version', '版本'],
    ['sign in', '登录'],
    ['logout', '退出登录'],
  ],
  'zh-TW': [
    ['tunnels', '隧道'],
    ['tunnel', '隧道'],
    ['frp', '隧道'],
    ['instances', '實例'],
    ['instance', '實例'],
    ['downloads', '下載'],
    ['download', '下載'],
    ['files', '檔案'],
    ['file', '檔案'],
    ['nodes', '節點'],
    ['node', '節點'],
    ['settings', '設定'],
    ['setting', '設定'],
    ['update', '更新'],
    ['updates', '更新'],
    ['add', '新增'],
    ['new', '新增'],
    ['no', '無'],
    ['load', '載入'],
    ['open', '開啟'],
    ['public', '公開'],
    ['server', '伺服器'],
    ['required', '必填'],
    ['running', '執行中'],
    ['stopped', '已停止'],
    ['failed', '失敗'],
    ['error', '錯誤'],
    ['success', '成功'],
    ['save', '儲存'],
    ['delete', '刪除'],
    ['create', '建立'],
    ['edit', '編輯'],
    ['search', '搜尋'],
    ['cache', '快取'],
    ['version', '版本'],
    ['sign in', '登入'],
    ['logout', '登出'],
  ],
  ja: [
    ['tunnels', 'トンネル'],
    ['tunnel', 'トンネル'],
    ['frp', 'トンネル'],
    ['instances', 'インスタンス'],
    ['instance', 'インスタンス'],
    ['downloads', 'ダウンロード'],
    ['download', 'ダウンロード'],
    ['files', 'ファイル'],
    ['file', 'ファイル'],
    ['nodes', 'ノード'],
    ['node', 'ノード'],
    ['settings', '設定'],
    ['setting', '設定'],
    ['update', '更新'],
    ['updates', '更新'],
    ['add', '追加'],
    ['new', '新規'],
    ['no', 'なし'],
    ['load', '読み込み'],
    ['open', '開く'],
    ['public', '公開'],
    ['server', 'サーバー'],
    ['required', '必須'],
    ['running', '実行中'],
    ['stopped', '停止'],
    ['failed', '失敗'],
    ['error', 'エラー'],
    ['success', '成功'],
    ['save', '保存'],
    ['delete', '削除'],
    ['create', '作成'],
    ['edit', '編集'],
    ['search', '検索'],
    ['cache', 'キャッシュ'],
    ['version', 'バージョン'],
    ['sign in', 'ログイン'],
    ['logout', 'ログアウト'],
  ],
  ko: [
    ['read-only', '읽기 전용'],
    ['copy', '복사'],
    ['copied', '복사됨'],
    ['details', '세부 정보'],
    ['diagnostics', '진단'],
    ['report', '보고서'],
    ['task', '작업'],
    ['tasks', '작업'],
    ['queue', '대기열'],
    ['queued', '대기 중'],
    ['cancel', '취소'],
    ['close', '닫기'],
    ['back', '뒤로'],
    ['next', '다음'],
    ['previous', '이전'],
    ['health', '상태'],
    ['current', '현재'],
    ['latest', '최신'],
    ['available', '사용 가능'],
    ['enabled', '활성화됨'],
    ['disabled', '비활성화됨'],
    ['optional', '선택 사항'],
    ['password', '비밀번호'],
    ['username', '사용자 이름'],
    ['token', '토큰'],
    ['endpoint', '엔드포인트'],
    ['port', '포트'],
    ['path', '경로'],
    ['name', '이름'],
    ['size', '크기'],
    ['time', '시간'],
    ['line', '줄'],
    ['lines', '줄'],
    ['tail', 'tail'],
    ['clipboard', '클립보드'],
    ['clear', '지우기'],
    ['warm', '예열'],
    ['installing', '설치 중'],
    ['install', '설치'],
    ['verifying', '검증 중'],
    ['verify', '검증'],
    ['imported', '가져옴'],
    ['import', '가져오기'],
    ['export', '내보내기'],
    ['world', '월드'],
    ['cluster', '클러스터'],
    ['template', '템플릿'],
    ['modpack', '모드팩'],
    ['private', '비공개'],
    ['mode', '모드'],
    ['login', '로그인'],
    ['logout', '로그아웃'],
    ['sign out', '로그아웃'],
    ['sign in', '로그인'],
    ['tunnels', '터널'],
    ['tunnel', '터널'],
    ['frp', '터널'],
    ['instances', '인스턴스'],
    ['instance', '인스턴스'],
    ['downloads', '다운로드'],
    ['download', '다운로드'],
    ['files', '파일'],
    ['file', '파일'],
    ['nodes', '노드'],
    ['node', '노드'],
    ['settings', '설정'],
    ['setting', '설정'],
    ['update', '업데이트'],
    ['updates', '업데이트'],
    ['add', '추가'],
    ['new', '새로 만들기'],
    ['no', '없음'],
    ['load', '불러오기'],
    ['open', '열기'],
    ['public', '공개'],
    ['server', '서버'],
    ['required', '필수'],
    ['running', '실행 중'],
    ['stopped', '중지됨'],
    ['failed', '실패'],
    ['error', '오류'],
    ['success', '성공'],
    ['save', '저장'],
    ['delete', '삭제'],
    ['create', '생성'],
    ['edit', '편집'],
    ['search', '검색'],
    ['cache', '캐시'],
    ['version', '버전'],
    ['sign in', '로그인'],
    ['logout', '로그아웃'],
  ],
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function replaceTokens(source: string, tokens: ReadonlyArray<readonly [string, string]>): string {
  let out = source
  for (const [from, to] of tokens) {
    const pattern = new RegExp(`\\b${escapeRegExp(from)}\\b`, 'gi')
    out = out.replace(pattern, to)
  }
  return out
}

function looksLikeCodeOrConfigText(source: string): boolean {
  const core = source.trim()
  if (!core) return false

  if (core.length > 120 && !/\s/.test(core)) return true

  if (/^[A-Za-z0-9_./:-]+$/.test(core) && !core.includes(' ')) {
    if (/^(https?:|ws:|wss:|file:|mailto:)/i.test(core)) return true
    if (core.includes('/') || core.includes('::') || core.includes('.')) return true
  }

  if (/^(bg-|text-|border-|ring-|px-|py-|pt-|pb-|pl-|pr-|mx-|my-|mt-|mb-|ml-|mr-|grid|flex|items-|justify-|rounded|shadow|dark:)/.test(core)) {
    return true
  }

  if (/^[.#\[]/.test(core)) return true
  if (/^M\d/.test(core)) return true
  if (/^(true|false|null|undefined)$/i.test(core)) return true
  if (/^[A-Z0-9_:-]+$/.test(core)) return true
  if (/^(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b/.test(core)) return true
  if (core.includes('://')) return true

  if (/\.(png|jpg|jpeg|gif|webp|svg|ico|json|toml|yaml|yml|ini|conf|cfg|log|txt|zip|tar|gz|7z|rar)\b/i.test(core)) {
    return true
  }

  if (/\b(class|className|style|variant|placeholder|aria-label|tabindex|viewBox|d|fill|stroke)\b/.test(core)) {
    return true
  }

  return false
}

function sanitizeMachineTranslation(locale: Exclude<AppLocale, 'en'>, source: string, translated: string): string {
  if (locale === 'ja' || locale === 'ko') return translated

  if (!/[A-Za-z]/.test(source)) return translated
  if (looksLikeCodeOrConfigText(source)) return source

  const baseReplacements = [
    ['行动', '操作'],
    ['行動', '操作'],
    ['代理人', 'Agent'],
    ['先进的', locale === 'zh-TW' ? '進階' : '高级'],
    ['先進的', '進階'],
    ['创造', locale === 'zh-TW' ? '建立' : '创建'],
    ['創造', '建立'],
    ['當前的', '目前'],
    ['当前的', '当前'],
    ['黑暗的', locale === 'zh-TW' ? '深色' : '深色'],
    ['细节', '详情'],
    ['細節', '詳情'],
    ['使能够', locale === 'zh-TW' ? '啟用' : '启用'],
    ['使能夠', '啟用'],
    ['出口', locale === 'zh-TW' ? '退出' : '退出'],
    ['提炼', locale === 'zh-TW' ? '解壓' : '解压'],
    ['提煉', '解壓'],
    ['失败的', locale === 'zh-TW' ? '失敗' : '失败'],
    ['失敗的', '失敗'],
    ['向前', locale === 'zh-TW' ? '前進' : '前进'],
    ['暗示', locale === 'zh-TW' ? '提示' : '提示'],
    ['进口', locale === 'zh-TW' ? '匯入' : '导入'],
    ['進口', '匯入'],
    ['小路', locale === 'zh-TW' ? '路徑' : '路径'],
    ['港口', locale === 'zh-TW' ? '連接埠' : '端口'],
    ['民眾', '公開'],
    ['民众', '公网'],
    ['跑步', locale === 'zh-TW' ? '執行' : '运行'],
    ['節省', '儲存'],
    ['节省', '保存'],
    ['地位', locale === 'zh-TW' ? '狀態' : '状态'],
    ['尾巴', locale === 'zh-TW' ? '尾端' : '尾部'],
    ['代幣', '權杖'],
    ['代币', '令牌'],
    ['價值', '值'],
    ['价值', '值'],
    ['香草', locale === 'zh-TW' ? '預設' : '默认'],
    ['壞網關', '閘道錯誤'],
    ['坏网关', '网关错误'],
    ['詛咒鍛造', 'CurseForge'],
    ['诅咒锻造', 'CurseForge'],
    ['不要一起挨餓', '饑荒聯機版'],
    ['不要一起挨饿', '饥荒联机版'],
    ['玻璃鋼', 'frp'],
    ['玻璃钢', 'frp'],
    ['溫暖的', '預熱'],
    ['温暖的', '预热'],
    ['可用的', locale === 'zh-TW' ? '可用' : '可用'],
    ['逃脫', 'Esc'],
    ['逃脱', 'Esc'],
    ['朋友世界', locale === 'zh-TW' ? '幻獸帕魯' : '幻兽帕鲁'],
    ['友世界', locale === 'zh-TW' ? '幻獸帕魯' : '幻兽帕鲁'],
    ['目的地:', 'dst:'],
    ['林服務器', 'The Forest 伺服器'],
    ['林服务器', 'The Forest 服务器'],
  ] as const

  let out = translated
  for (const [from, to] of baseReplacements) {
    out = out.split(from).join(to)
  }

  if (source === 'Enter') return locale === 'zh-TW' ? 'Enter' : '回车'
  if (source === 'Escape') return 'Esc'
  if (source === 'Alloy DST server') return locale === 'zh-TW' ? 'Alloy 饑荒聯機版伺服器' : 'Alloy 饥荒联机版服务器'
  if (source === 'Alloy Factorio server') return locale === 'zh-TW' ? 'Alloy 異星工廠伺服器' : 'Alloy 异星工厂服务器'
  if (source === 'Alloy Palworld server') return locale === 'zh-TW' ? 'Alloy 幻獸帕魯伺服器' : 'Alloy 幻兽帕鲁服务器'
  if (source === 'Core Keeper') return locale === 'zh-TW' ? '核心守護者' : '核心守护者'
  if (source === 'Core Keeper (Vanilla)') return locale === 'zh-TW' ? '核心守護者' : '核心守护者'
  if (source === 'Core Keeper: Dedicated') return locale === 'zh-TW' ? '核心守護者' : '核心守护者'
  if (source === '7 Days to Die') return locale === 'zh-TW' ? '七日殺' : '七日杀'
  if (source === '7 Days to Die (Vanilla)') return locale === 'zh-TW' ? '七日殺' : '七日杀'
  if (source === '7 Days to Die: Dedicated') return locale === 'zh-TW' ? '七日殺' : '七日杀'
  if (source === 'Sons of the Forest') return '森林之子'
  if (source === 'Sons of the Forest (Vanilla)') return '森林之子'
  if (source === 'Sons of the Forest: Dedicated') return locale === 'zh-TW' ? '森林之子' : '森林之子'
  if (source === 'The Forest') return '森林'
  if (source === 'The Forest (Vanilla)') return '森林'
  if (source === 'The Forest: Dedicated') return locale === 'zh-TW' ? '森林' : '森林'
  if (source === 'Terraria (Vanilla)') return locale === 'zh-TW' ? '泰拉瑞亞' : '泰拉瑞亚'
  if (source === 'Terraria: Vanilla') return locale === 'zh-TW' ? '泰拉瑞亞' : '泰拉瑞亚'
  if (source === 'Factorio (Vanilla)') return locale === 'zh-TW' ? '異星工廠' : '异星工厂'
  if (source === 'Factorio: Vanilla') return locale === 'zh-TW' ? '異星工廠' : '异星工厂'
  if (source === 'Palworld') return locale === 'zh-TW' ? '幻獸帕魯' : '幻兽帕鲁'
  if (source === 'Palworld (Vanilla)') return locale === 'zh-TW' ? '幻獸帕魯' : '幻兽帕鲁'
  if (source === 'Palworld: Vanilla') return locale === 'zh-TW' ? '幻獸帕魯' : '幻兽帕鲁'

  if (source === 'installing 7 days to die server via steamcmd…') {
    return locale === 'zh-TW' ? '正在透過 SteamCMD 安裝七日殺伺服器…' : '正在通过 SteamCMD 安装七日杀服务器…'
  }
  if (source === 'installing core keeper server via steamcmd…') {
    return locale === 'zh-TW' ? '正在透過 SteamCMD 安裝核心守護者伺服器…' : '正在通过 SteamCMD 安装核心守护者服务器…'
  }
  if (source === 'installing dst dedicated server via steamcmd…') {
    return locale === 'zh-TW' ? '正在透過 SteamCMD 安裝饑荒聯機版專用伺服器…' : '正在通过 SteamCMD 安装饥荒联机版专用服务器…'
  }
  if (source === 'installing palworld server via steamcmd…') {
    return locale === 'zh-TW' ? '正在透過 SteamCMD 安裝幻獸帕魯伺服器…' : '正在通过 SteamCMD 安装幻兽帕鲁服务器…'
  }
  if (source === 'installing sons of the forest server via steamcmd…') {
    return locale === 'zh-TW' ? '正在透過 SteamCMD 安裝森林之子伺服器…' : '正在通过 SteamCMD 安装森林之子服务器…'
  }
  if (source === 'installing the forest server via steamcmd…') {
    return locale === 'zh-TW' ? '正在透過 SteamCMD 安裝森林伺服器…' : '正在通过 SteamCMD 安装森林服务器…'
  }

  if (source === 'verifying 7 days to die install files…') return locale === 'zh-TW' ? '正在驗證七日殺安裝檔案…' : '正在验证七日杀安装文件…'
  if (source === 'verifying core keeper install files…') return locale === 'zh-TW' ? '正在驗證核心守護者安裝檔案…' : '正在验证核心守护者安装文件…'
  if (source === 'verifying dst install files…') return locale === 'zh-TW' ? '正在驗證饑荒聯機版安裝檔案…' : '正在验证饥荒联机版安装文件…'
  if (source === 'verifying palworld install files…') return locale === 'zh-TW' ? '正在驗證幻獸帕魯安裝檔案…' : '正在验证幻兽帕鲁安装文件…'
  if (source === 'verifying sons of the forest install files…') {
    return locale === 'zh-TW' ? '正在驗證森林之子安裝檔案…' : '正在验证森林之子安装文件…'
  }
  if (source === 'verifying the forest install files…') {
    return locale === 'zh-TW' ? '正在驗證森林安裝檔案…' : '正在验证森林安装文件…'
  }

  if (source.endsWith(':vanilla@')) {
    const prefix = source.slice(0, -'vanilla@'.length)
    return `${prefix}@`
  }

  if (source === 'Optional. For example: 20000-20100,21000. Used when remote_port is auto.') {
    return locale === 'zh-TW'
      ? '可選。例如：20000-20100,21000。當 remote_port 為 auto 時使用。'
      : '可选。例如：20000-20100,21000。当 remote_port 为 auto 时使用。'
  }

  if (source === 'Optional. Paste an FRP config to expose this instance (auto-detects INI/TOML/YAML/JSON).') {
    return locale === 'zh-TW'
      ? '可選。貼上隧道設定以公開此實例（自動偵測 INI/TOML/YAML/JSON）。'
      : '可选。粘贴隧道配置以公开此实例（自动检测 INI/TOML/YAML/JSON）。'
  }

  if (source === 'Sets JVM heap size. Too low can crash; too high can starve the host.') {
    return locale === 'zh-TW'
      ? '設定 JVM Heap 大小。太低可能崩潰，太高會擠壓宿主機記憶體。'
      : '设置 JVM 堆大小。过低可能崩溃，过高会挤占宿主机内存。'
  }

  return out
}

export function translateLooseText(locale: AppLocale, input: string): string {
  if (locale === 'en') return input
  if (!input) return input

  const match = input.match(/^(\s*)([\s\S]*?)(\s*)$/)
  if (!match) return input
  const leading = match[1] ?? ''
  const core = match[2] ?? ''
  const trailing = match[3] ?? ''

  if (!/[A-Za-z]/.test(core)) return input

  const direct = loosePhraseCatalog[locale][core]
  if (direct) return `${leading}${direct}${trailing}`

  const lower = loosePhraseCatalogLower[locale][core.toLowerCase()]
  if (lower) return `${leading}${lower}${trailing}`

  if (/^[A-Z0-9_:-]+$/.test(core)) return input

  const tokenized = replaceTokens(core, tokenCatalog[locale])
  if (tokenized !== core) return `${leading}${tokenized}${trailing}`

  return input
}
