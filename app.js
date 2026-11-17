/**
 * Skitch Modoki - クライアントサイド完結型 画像注釈・編集アプリケーション
 */

(() => {
  // --- DOM要素の取得 ---
  const fileInput = document.getElementById('file-input');
  const btnOpen = document.getElementById('btn-open');
  const btnEmptyOpen = document.getElementById('btn-empty-open');
  const btnSample = document.getElementById('btn-sample');
  const dropCard = document.getElementById('drop-card');
  const workspace = document.getElementById('workspace');
  const emptyState = document.getElementById('empty-state');
  const canvasWrapper = document.getElementById('canvas-wrapper');
  const canvasStage = document.getElementById('canvas-stage');
  const canvas = document.getElementById('editor-canvas');
  const ctx = canvas.getContext('2d');

  const toolButtons = document.querySelectorAll('.tool-btn');
  const colorSwatches = document.querySelectorAll('.color-swatch');
  const sizeButtons = document.querySelectorAll('.size-btn');

  const btnUndo = document.getElementById('btn-undo');
  const btnRedo = document.getElementById('btn-redo');
  const btnDelete = document.getElementById('btn-delete');
  const btnClear = document.getElementById('btn-clear');
  const btnSave = document.getElementById('btn-save');

  const textEditor = document.getElementById('text-editor');
  const textInput = document.getElementById('text-input');
  const btnTextOk = document.getElementById('btn-text-ok');
  const btnTextCancel = document.getElementById('btn-text-cancel');

  const dragOverlay = document.getElementById('drag-overlay');
  const loadingOverlay = document.getElementById('loading-overlay');
  const loadingMessage = document.getElementById('loading-message');

  const statusHint = document.getElementById('status-hint');
  const imageInfo = document.getElementById('image-info');
  const zoomControls = document.getElementById('zoom-controls');
  const btnZoomFit = document.getElementById('btn-zoom-fit');
  const btnZoom100 = document.getElementById('btn-zoom-100');

  // --- アプリケーション状態 ---
  let baseImage = null;          // 読み込まれた元画像 (HTMLImageElement / HTMLCanvasElement)
  let currentFileName = 'image'; // 保存時のベースファイル名
  let zoomMode = 'fit';          // 'fit' | '100'

  let currentTool = 'arrow';     // 'select' | 'arrow' | 'rect' | 'ellipse' | 'text' | 'mosaic' | 'pen'
  let currentColor = '#FF0066';  // 選択中の色
  let currentSize = 'medium';    // 'small' | 'medium' | 'large'

  let shapes = [];               // 描画された図形オブジェクトの配列
  let selectedId = null;         // 現在選択中の図形ID
  let undoStack = [];            // Undo用履歴スタック
  let redoStack = [];            // Redo用履歴スタック

  // マウス/タッチ操作状態
  let interactionMode = null;    // 'drawing' | 'moving' | 'resizing'
  let activeHandle = null;       // リサイズ中のハンドル名 ('start', 'end', 'nw', 'ne', 'se', 'sw')
  let dragStartPos = { x: 0, y: 0 };
  let shapeSnapshot = null;      // 移動・リサイズ開始時の図形コピー
  let activeDraftShape = null;   // 新規ドラッグ描画中の図形

  // テキスト編集状態
  let pendingTextPos = null;     // 新規テキスト配置座標 { x, y }
  let editingTextId = null;      // 既存テキスト再編集時のID

  // モザイク処理用オフスクリーンキャンバス
  const mosaicBufferCanvas = document.createElement('canvas');
  const mosaicBufferCtx = mosaicBufferCanvas.getContext('2d');

  // ツールごとのヒントメッセージ
  const TOOL_HINTS = {
    select: '🖱️ 選択ツール：図形をクリックして移動やサイズ変更、色変更、Deleteキーで削除ができます（文字はダブルクリックで再編集）',
    arrow: '🏹 矢印ツール：ドラッグして矢印を引きます。描いた矢印の端をつまんで向きや長さを調整できます',
    rect: '⬜ 四角枠ツール：ドラッグして注目させたい箇所を四角く囲みます',
    ellipse: '⭕ 丸枠ツール：ドラッグして注目させたい箇所を丸・楕円で囲みます',
    text: '🔤 文字ツール：画像の上をクリックして白縁つきの見やすい文字を入力します（ダブルクリックで後から修正可能）',
    mosaic: '🟦 モザイクツール：見せたくない部分をドラッグしてモザイク（ぼかし）をかけます',
    pen: '✏️ ペンツール：ドラッグして自由な線を描き込みます'
  };

  // サイズ倍率定義
  const SIZE_SCALE = {
    small: 0.72,
    medium: 1.0,
    large: 1.45
  };

  // --- 初期化 ---
  function init() {
    bindEvents();
    updateStatusHint();
    updateToolbarState();
  }

  // 画像の解像度に応じた基準スケール単位（高解像度のiPhone写真でも矢印が細くならないように自動補正）
  function getBaseUnit() {
    if (!canvas.width || !canvas.height) return 1;
    const minDim = Math.min(canvas.width, canvas.height);
    return Math.max(0.85, minDim / 900);
  }

  // 白い色を選んだときだけ縁取りを黒にする（視認性確保）
  function getOutlineColor(fillColor) {
    return fillColor.toUpperCase() === '#FFFFFF' ? '#1E2229' : '#FFFFFF';
  }

  // ユニークID生成
  function createId() {
    return 'shape_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  }

  // --- イベント登録 ---
  function bindEvents() {
    // ファイルを開く
    btnOpen.addEventListener('click', () => fileInput.click());
    btnEmptyOpen.addEventListener('click', (e) => {
      e.stopPropagation();
      fileInput.click();
    });
    dropCard.addEventListener('click', (e) => {
      if (e.target === btnSample || e.target === btnEmptyOpen) return;
      fileInput.click();
    });
    fileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        handleFile(e.target.files[0]);
        fileInput.value = '';
      }
    });

    // サンプル画像ボタン
    btnSample.addEventListener('click', (e) => {
      e.stopPropagation();
      loadSampleImage();
    });

    // ドラッグ＆ドロップ対応（画面全体）
    let dragCounter = 0;
    window.addEventListener('dragenter', (e) => {
      e.preventDefault();
      dragCounter++;
      dragOverlay.classList.remove('hidden');
    });
    window.addEventListener('dragover', (e) => {
      e.preventDefault();
    });
    window.addEventListener('dragleave', (e) => {
      e.preventDefault();
      dragCounter--;
      if (dragCounter <= 0) {
        dragCounter = 0;
        dragOverlay.classList.add('hidden');
      }
    });
    window.addEventListener('drop', (e) => {
      e.preventDefault();
      dragCounter = 0;
      dragOverlay.classList.add('hidden');
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
        handleFile(e.dataTransfer.files[0]);
      }
    });

    // ツール切替
    toolButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        commitTextIfOpen();
        setTool(btn.dataset.tool);
      });
    });

    // カラーパレット切替（図形選択中ならその図形の色も即変更）
    colorSwatches.forEach((swatch) => {
      swatch.addEventListener('click', () => {
        currentColor = swatch.dataset.color;
        colorSwatches.forEach((s) => s.classList.toggle('active', s === swatch));

        if (selectedId) {
          const shape = shapes.find((s) => s.id === selectedId);
          if (shape && shape.type !== 'mosaic') {
            saveHistory();
            shape.color = currentColor;
            render();
          }
        }
      });
    });

    // サイズ切替（図形選択中ならその図形のサイズも即変更）
    sizeButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        currentSize = btn.dataset.size;
        sizeButtons.forEach((b) => b.classList.toggle('active', b === btn));

        if (selectedId) {
          const shape = shapes.find((s) => s.id === selectedId);
          if (shape) {
            saveHistory();
            shape.size = currentSize;
            render();
          }
        }
      });
    });

    // Undo / Redo / Delete / Clear / Save
    btnUndo.addEventListener('click', undo);
    btnRedo.addEventListener('click', redo);
    btnDelete.addEventListener('click', deleteSelectedShape);
    btnClear.addEventListener('click', clearAllShapes);
    btnSave.addEventListener('click', exportImage);

    // ズーム切替
    btnZoomFit.addEventListener('click', () => setZoomMode('fit'));
    btnZoom100.addEventListener('click', () => setZoomMode('100'));
    window.addEventListener('resize', () => {
      if (baseImage && zoomMode === 'fit') {
        applyCanvasDisplaySize();
      }
    });

    // キャンバスのポインター操作
    canvas.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('dblclick', onDoubleClick);

    // テキストエディタ操作
    btnTextOk.addEventListener('click', commitTextEditor);
    btnTextCancel.addEventListener('click', closeTextEditor);
    textInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        commitTextEditor();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closeTextEditor();
      }
    });

    // キーボードショートカット
    window.addEventListener('keydown', (e) => {
      // テキスト入力中はショートカット無効
      if (!textEditor.classList.contains('hidden')) return;

      const isCmdOrCtrl = e.metaKey || e.ctrlKey;
      if (isCmdOrCtrl && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          redo();
        } else {
          undo();
        }
        return;
      }
      if (isCmdOrCtrl && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedId) {
          e.preventDefault();
          deleteSelectedShape();
        }
        return;
      }

      // ツール切替ショートカット
      if (!isCmdOrCtrl && !e.altKey) {
        const key = e.key.toLowerCase();
        if (key === 'v') setTool('select');
        else if (key === 'a') setTool('arrow');
        else if (key === 'r') setTool('rect');
        else if (key === 'o' || key === 'e') setTool('ellipse');
        else if (key === 't') setTool('text');
        else if (key === 'm') setTool('mosaic');
        else if (key === 'p') setTool('pen');
      }
    });
  }

  function setTool(toolName) {
    currentTool = toolName;
    toolButtons.forEach((b) => b.classList.toggle('active', b.dataset.tool === toolName));
    updateStatusHint();
    updateCursor();
  }

  function updateStatusHint() {
    statusHint.textContent = TOOL_HINTS[currentTool] || '';
  }

  // --- ファイル読み込み & HEIC自動変換処理 ---
  async function isHeicFile(file) {
    const name = (file.name || '').toLowerCase();
    const type = (file.type || '').toLowerCase();
    if (
      name.endsWith('.heic') ||
      name.endsWith('.heif') ||
      type === 'image/heic' ||
      type === 'image/heif' ||
      type === 'image/heic-sequence' ||
      type === 'image/heif-sequence'
    ) {
      return true;
    }

    // 拡張子やMIMEタイプが欠落している場合に備え、先頭12バイトのマジックナンバー（ftypheic等）もチェック
    try {
      const slice = file.slice(0, 12);
      const buffer = await slice.arrayBuffer();
      if (buffer.byteLength >= 12) {
        const bytes = new Uint8Array(buffer);
        const boxType = String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]);
        const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
        if (boxType === 'ftyp' && ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'].includes(brand)) {
          return true;
        }
      }
    } catch (_) {
      // 無視して通常判定へ
    }
    return false;
  }

  async function handleFile(file) {
    showLoading('画像を読み込んでいます...');
    try {
      currentFileName = (file.name || 'image').replace(/\.[^/.]+$/, '');
      const heic = await isHeicFile(file);

      let targetBlob = file;
      if (heic) {
        showLoading('iPhoneのHEIC画像をブラウザ用に変換しています...');
        targetBlob = await convertHeicToBlob(file);
      }

      const img = await loadBlobAsImage(targetBlob);
      setupCanvasWithImage(img);
    } catch (err) {
      console.error('画像読み込みエラー:', err);
      alert('画像の読み込みに失敗しました。ファイルが壊れているか、未対応の形式の可能性があります。\n詳細: ' + (err.message || err));
    } finally {
      hideLoading();
    }
  }

  async function convertHeicToBlob(file) {
    // 1. heic2any ライブラリで変換を試行
    if (typeof window.heic2any === 'function') {
      try {
        const converted = await window.heic2any({
          blob: file,
          toType: 'image/png',
          quality: 0.95
        });
        return Array.isArray(converted) ? converted[0] : converted;
      } catch (err) {
        console.warn('heic2anyでの変換に失敗しました。ブラウザの標準デコーダを試行します:', err);
      }
    }
    // 2. Safariなどブラウザ自身がHEICを直接デコードできる場合は元のファイルを返す
    return file;
  }

  function loadBlobAsImage(blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('ブラウザで画像データを展開できませんでした。'));
      };
      img.src = url;
    });
  }

  function setupCanvasWithImage(img) {
    baseImage = img;
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;

    shapes = [];
    selectedId = null;
    undoStack = [];
    redoStack = [];
    closeTextEditor();

    emptyState.classList.add('hidden');
    canvasWrapper.classList.remove('hidden');
    zoomControls.classList.remove('hidden');

    imageInfo.textContent = `${canvas.width} × ${canvas.height} px`;
    applyCanvasDisplaySize();
    updateToolbarState();
    render();
  }

  // サンプル画像を生成して読み込む（すぐに試せる機能）
  function loadSampleImage() {
    const sampleCanvas = document.createElement('canvas');
    sampleCanvas.width = 1200;
    sampleCanvas.height = 760;
    const sCtx = sampleCanvas.getContext('2d');

    // 背景グラデーション
    const grad = sCtx.createLinearGradient(0, 0, 1200, 760);
    grad.addColorStop(0, '#eef2ff');
    grad.addColorStop(1, '#e0e7ff');
    sCtx.fillStyle = grad;
    sCtx.fillRect(0, 0, 1200, 760);

    // 疑似ブラウザウィンドウ風カード
    sCtx.fillStyle = '#ffffff';
    sCtx.shadowColor = 'rgba(0, 0, 0, 0.12)';
    sCtx.shadowBlur = 24;
    sCtx.shadowOffsetY = 8;
    roundRect(sCtx, 90, 70, 1020, 620, 16);
    sCtx.fill();
    sCtx.shadowColor = 'transparent';

    // ヘッダーバー
    sCtx.fillStyle = '#1e293b';
    roundRectTop(sCtx, 90, 70, 1020, 54, 16);
    sCtx.fill();

    // 信号ボタン
    ['#ef4444', '#f59e0b', '#10b981'].forEach((c, i) => {
      sCtx.fillStyle = c;
      sCtx.beginPath();
      sCtx.arc(124 + i * 24, 97, 7, 0, Math.PI * 2);
      sCtx.fill();
    });

    // ダッシュボード風コンテンツ
    sCtx.fillStyle = '#334155';
    sCtx.font = 'bold 26px sans-serif';
    sCtx.fillText('月次レポート＆タスク管理画面（サンプル画像）', 135, 180);

    // カード3枚
    const cards = [
      { title: '今月のアクセス数', val: '128,450 PV', badge: '+18.4%', color: '#3b82f6' },
      { title: '新規申込件数', val: '1,420 件', badge: '目標達成!', color: '#10b981' },
      { title: '要確認アラート', val: '3 件の未対応', badge: '要チェック', color: '#f43f5e' }
    ];
    cards.forEach((c, i) => {
      const x = 135 + i * 320;
      const y = 215;
      sCtx.fillStyle = '#f8fafc';
      sCtx.strokeStyle = '#e2e8f0';
      sCtx.lineWidth = 2;
      roundRect(sCtx, x, y, 290, 150, 12);
      sCtx.fill();
      sCtx.stroke();

      sCtx.fillStyle = '#64748b';
      sCtx.font = 'bold 16px sans-serif';
      sCtx.fillText(c.title, x + 22, y + 40);

      sCtx.fillStyle = '#0f172a';
      sCtx.font = 'bold 32px sans-serif';
      sCtx.fillText(c.val, x + 22, y + 90);

      sCtx.fillStyle = c.color;
      sCtx.font = 'bold 15px sans-serif';
      sCtx.fillText(c.badge, x + 22, y + 125);
    });

    // 下部エリア（個人情報・シークレット欄のサンプル）
    sCtx.fillStyle = '#f1f5f9';
    roundRect(sCtx, 135, 400, 930, 240, 12);
    sCtx.fill();

    sCtx.fillStyle = '#334155';
    sCtx.font = 'bold 20px sans-serif';
    sCtx.fillText('サーバー設定情報（モザイクや枠線のテストにお使いください）', 165, 445);

    sCtx.fillStyle = '#475569';
    sCtx.font = '18px monospace';
    sCtx.fillText('・担当者メールアドレス : yamada.taro@example.com', 165, 495);
    sCtx.fillText('・APIシークレットキー  : sk_live_9876543210_secret_token', 165, 535);
    sCtx.fillText('・本番環境ボタンの位置 : 右下の「公開する」をクリック', 165, 575);

    // 右下のダミーボタン
    sCtx.fillStyle = '#2563eb';
    roundRect(sCtx, 860, 560, 170, 52, 10);
    sCtx.fill();
    sCtx.fillStyle = '#ffffff';
    sCtx.font = 'bold 18px sans-serif';
    sCtx.fillText('公開する 🚀', 895, 592);

    currentFileName = 'sample-report';
    const img = new Image();
    img.onload = () => {
      setupCanvasWithImage(img);
      // サンプルとしてSkitch風の矢印と枠線を1つずつ最初から配置しておく（すぐ動かせる体験）
      shapes.push(
        {
          id: createId(),
          type: 'arrow',
          x1: 720,
          y1: 625,
          x2: 848,
          y2: 590,
          color: '#FF0066',
          size: 'medium'
        },
        {
          id: createId(),
          type: 'rect',
          x1: 760,
          y1: 205,
          x2: 1075,
          y2: 375,
          color: '#FF0066',
          size: 'medium'
        },
        {
          id: createId(),
          type: 'text',
          x: 765,
          y: 162,
          text: 'ここを確認！',
          color: '#FF0066',
          size: 'medium'
        }
      );
      updateToolbarState();
      render();
    };
    img.src = sampleCanvas.toDataURL('image/png');
  }

  function roundRect(context, x, y, w, h, r) {
    context.beginPath();
    context.moveTo(x + r, y);
    context.arcTo(x + w, y, x + w, y + h, r);
    context.arcTo(x + w, y + h, x, y + h, r);
    context.arcTo(x, y + h, x, y, r);
    context.arcTo(x, y, x + w, y, r);
    context.closePath();
  }

  function roundRectTop(context, x, y, w, h, r) {
    context.beginPath();
    context.moveTo(x + r, y);
    context.lineTo(x + w - r, y);
    context.quadraticCurveTo(x + w, y, x + w, y + r);
    context.lineTo(x + w, y + h);
    context.lineTo(x, y + h);
    context.lineTo(x, y + r);
    context.quadraticCurveTo(x, y, x + r, y);
    context.closePath();
  }

  // --- 表示サイズ・ズーム制御 ---
  function setZoomMode(mode) {
    zoomMode = mode;
    btnZoomFit.classList.toggle('active', mode === 'fit');
    btnZoom100.classList.toggle('active', mode === '100');
    applyCanvasDisplaySize();
  }

  function applyCanvasDisplaySize() {
    if (!baseImage) return;
    if (zoomMode === '100') {
      canvas.style.width = `${canvas.width}px`;
      canvas.style.height = `${canvas.height}px`;
      return;
    }

    // ワークスペース内に収まる最大サイズを計算
    const pad = 56;
    const availW = Math.max(200, workspace.clientWidth - pad);
    const availH = Math.max(200, workspace.clientHeight - pad);
    const scale = Math.min(1, availW / canvas.width, availH / canvas.height);

    canvas.style.width = `${Math.round(canvas.width * scale)}px`;
    canvas.style.height = `${Math.round(canvas.height * scale)}px`;
  }

  // マウス/タッチ座標をキャンバス内部のピクセル座標に変換
  function getCanvasCoords(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY
    };
  }

  // --- ポインター操作（描画・選択・移動・リサイズ） ---
  function onPointerDown(e) {
    if (!baseImage || e.button > 0) return;

    // もしテキスト入力中なら先に確定する
    if (!textEditor.classList.contains('hidden')) {
      commitTextEditor();
      return;
    }

    const pos = getCanvasCoords(e);
    dragStartPos = pos;

    // 1. 現在選択中の図形がある場合、そのハンドル（つまみ）を掴んだか判定
    if (selectedId) {
      const selShape = shapes.find((s) => s.id === selectedId);
      if (selShape) {
        const handle = hitTestHandles(selShape, pos);
        if (handle) {
          saveHistory();
          interactionMode = 'resizing';
          activeHandle = handle;
          shapeSnapshot = cloneShape(selShape);
          canvas.setPointerCapture(e.pointerId);
          return;
        }
      }
    }

    // 2. 選択ツールのとき、または既存図形の上をクリックしたときの判定
    const hitShape = findTopShapeAt(pos);
    if (currentTool === 'select') {
      if (hitShape) {
        selectShape(hitShape.id);
        saveHistory();
        interactionMode = 'moving';
        shapeSnapshot = cloneShape(hitShape);
        canvas.setPointerCapture(e.pointerId);
      } else {
        selectShape(null);
      }
      render();
      return;
    }

    // 描画ツール選択中でも、すでに選択されている図形の上を掴んだ場合は移動できるようにする
    if (selectedId && hitShape && hitShape.id === selectedId) {
      saveHistory();
      interactionMode = 'moving';
      shapeSnapshot = cloneShape(hitShape);
      canvas.setPointerCapture(e.pointerId);
      render();
      return;
    }

    // 3. 文字ツールの場合はクリック位置にテキスト入力欄を開く
    if (currentTool === 'text') {
      // 既存のテキストをクリックした場合はそのテキストを選択・移動できるようにする
      if (hitShape && hitShape.type === 'text') {
        selectShape(hitShape.id);
        saveHistory();
        interactionMode = 'moving';
        shapeSnapshot = cloneShape(hitShape);
        canvas.setPointerCapture(e.pointerId);
        render();
        return;
      }
      openTextEditorAt(pos.x, pos.y);
      return;
    }

    // 4. 新規図形のドラッグ描画開始
    selectShape(null);
    interactionMode = 'drawing';
    const newId = createId();

    if (currentTool === 'pen') {
      activeDraftShape = {
        id: newId,
        type: 'pen',
        points: [{ x: pos.x, y: pos.y }],
        color: currentColor,
        size: currentSize
      };
    } else {
      activeDraftShape = {
        id: newId,
        type: currentTool, // 'arrow' | 'rect' | 'ellipse' | 'mosaic'
        x1: pos.x,
        y1: pos.y,
        x2: pos.x,
        y2: pos.y,
        color: currentColor,
        size: currentSize
      };
    }

    canvas.setPointerCapture(e.pointerId);
    render();
  }

  function onPointerMove(e) {
    if (!baseImage) return;
    const pos = getCanvasCoords(e);

    if (!interactionMode) {
      updateHoverCursor(pos);
      return;
    }

    const dx = pos.x - dragStartPos.x;
    const dy = pos.y - dragStartPos.y;

    if (interactionMode === 'drawing' && activeDraftShape) {
      if (activeDraftShape.type === 'pen') {
        const lastPt = activeDraftShape.points[activeDraftShape.points.length - 1];
        if (Math.hypot(pos.x - lastPt.x, pos.y - lastPt.y) > 2) {
          activeDraftShape.points.push({ x: pos.x, y: pos.y });
        }
      } else {
        activeDraftShape.x2 = pos.x;
        activeDraftShape.y2 = pos.y;
      }
      render();
    } else if (interactionMode === 'moving' && selectedId && shapeSnapshot) {
      const shape = shapes.find((s) => s.id === selectedId);
      if (shape) {
        moveShapeFromSnapshot(shape, shapeSnapshot, dx, dy);
        render();
      }
    } else if (interactionMode === 'resizing' && selectedId && shapeSnapshot) {
      const shape = shapes.find((s) => s.id === selectedId);
      if (shape) {
        resizeShapeFromSnapshot(shape, shapeSnapshot, activeHandle, pos);
        render();
      }
    }
  }

  function onPointerUp(e) {
    if (!interactionMode) return;

    if (interactionMode === 'drawing' && activeDraftShape) {
      // 極端に小さいドラッグ（誤クリック）は無視、ただしその場に既存図形があれば選択する
      if (isShapeBigEnough(activeDraftShape)) {
        saveHistory();
        shapes.push(activeDraftShape);
        selectShape(activeDraftShape.id);
      } else {
        const hit = findTopShapeAt(dragStartPos);
        if (hit) {
          selectShape(hit.id);
        }
      }
      activeDraftShape = null;
    }

    interactionMode = null;
    activeHandle = null;
    shapeSnapshot = null;
    updateToolbarState();
    render();
  }

  // ダブルクリックで既存テキストを再編集
  function onDoubleClick(e) {
    if (!baseImage) return;
    const pos = getCanvasCoords(e);
    const hit = findTopShapeAt(pos);
    if (hit && hit.type === 'text') {
      openTextEditorForExisting(hit);
    }
  }

  function isShapeBigEnough(shape) {
    const unit = getBaseUnit();
    if (shape.type === 'pen') {
      return shape.points.length >= 2;
    }
    const dist = Math.hypot(shape.x2 - shape.x1, shape.y2 - shape.y1);
    return dist > 8 * unit;
  }

  function selectShape(id) {
    selectedId = id;
    if (id) {
      const shape = shapes.find((s) => s.id === id);
      if (shape) {
        if (shape.color) {
          currentColor = shape.color;
          colorSwatches.forEach((s) => s.classList.toggle('active', s.dataset.color === currentColor));
        }
        if (shape.size) {
          currentSize = shape.size;
          sizeButtons.forEach((b) => b.classList.toggle('active', b.dataset.size === currentSize));
        }
      }
    }
    updateToolbarState();
  }

  // --- テキスト入力オーバーレイ制御 ---
  function openTextEditorAt(canvasX, canvasY) {
    editingTextId = null;
    pendingTextPos = { x: canvasX, y: canvasY };
    positionTextEditorPopup(canvasX, canvasY);
    textInput.value = '';
    textEditor.classList.remove('hidden');
    setTimeout(() => textInput.focus(), 10);
  }

  function openTextEditorForExisting(textShape) {
    editingTextId = textShape.id;
    pendingTextPos = { x: textShape.x, y: textShape.y };
    positionTextEditorPopup(textShape.x, textShape.y);
    textInput.value = textShape.text;
    textEditor.classList.remove('hidden');
    setTimeout(() => {
      textInput.focus();
      textInput.select();
    }, 10);
  }

  function positionTextEditorPopup(canvasX, canvasY) {
    const displayW = canvas.clientWidth;
    const displayH = canvas.clientHeight;
    const scaleX = displayW / canvas.width;
    const scaleY = displayH / canvas.height;

    const left = Math.min(Math.max(8, canvasX * scaleX), Math.max(8, displayW - 260));
    const top = Math.min(Math.max(8, canvasY * scaleY), Math.max(8, displayH - 110));

    textEditor.style.left = `${left}px`;
    textEditor.style.top = `${top}px`;
  }

  function commitTextEditor() {
    if (textEditor.classList.contains('hidden')) return;
    const val = textInput.value.trim();

    if (editingTextId) {
      const existing = shapes.find((s) => s.id === editingTextId);
      if (existing) {
        if (val) {
          saveHistory();
          existing.text = val;
          existing.color = currentColor;
          existing.size = currentSize;
        } else {
          // 空にした場合は削除
          saveHistory();
          shapes = shapes.filter((s) => s.id !== editingTextId);
          selectedId = null;
        }
      }
    } else if (val && pendingTextPos) {
      saveHistory();
      const newTextShape = {
        id: createId(),
        type: 'text',
        x: pendingTextPos.x,
        y: pendingTextPos.y,
        text: val,
        color: currentColor,
        size: currentSize
      };
      shapes.push(newTextShape);
      selectShape(newTextShape.id);
    }

    closeTextEditor();
    updateToolbarState();
    render();
  }

  function commitTextIfOpen() {
    if (!textEditor.classList.contains('hidden')) {
      commitTextEditor();
    }
  }

  function closeTextEditor() {
    textEditor.classList.add('hidden');
    textInput.value = '';
    pendingTextPos = null;
    editingTextId = null;
  }

  // --- 図形の移動・リサイズ・複製 ---
  function cloneShape(shape) {
    return JSON.parse(JSON.stringify(shape));
  }

  function moveShapeFromSnapshot(shape, snap, dx, dy) {
    if (shape.type === 'text') {
      shape.x = snap.x + dx;
      shape.y = snap.y + dy;
    } else if (shape.type === 'pen') {
      shape.points = snap.points.map((pt) => ({ x: pt.x + dx, y: pt.y + dy }));
    } else {
      shape.x1 = snap.x1 + dx;
      shape.y1 = snap.y1 + dy;
      shape.x2 = snap.x2 + dx;
      shape.y2 = snap.y2 + dy;
    }
  }

  function resizeShapeFromSnapshot(shape, snap, handle, pos) {
    if (shape.type === 'arrow') {
      if (handle === 'start') {
        shape.x1 = pos.x;
        shape.y1 = pos.y;
      } else if (handle === 'end') {
        shape.x2 = pos.x;
        shape.y2 = pos.y;
      }
    } else if (shape.type === 'rect' || shape.type === 'ellipse' || shape.type === 'mosaic') {
      if (handle === 'nw') {
        shape.x1 = pos.x;
        shape.y1 = pos.y;
      } else if (handle === 'ne') {
        shape.x2 = pos.x;
        shape.y1 = pos.y;
      } else if (handle === 'se') {
        shape.x2 = pos.x;
        shape.y2 = pos.y;
      } else if (handle === 'sw') {
        shape.x1 = pos.x;
        shape.y2 = pos.y;
      }
    }
  }

  // --- キャンバス描画メイン処理 ---
  function render(includeSelectionUI = true) {
    if (!baseImage) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(baseImage, 0, 0, canvas.width, canvas.height);

    // 1. モザイクは背景画像に直接作用するため先に描画（または図形順に描画）
    for (const shape of shapes) {
      drawShape(ctx, shape);
    }

    if (activeDraftShape) {
      drawShape(ctx, activeDraftShape);
    }

    // 2. 選択中の図形があれば選択枠とハンドルを描画
    if (includeSelectionUI && selectedId) {
      const sel = shapes.find((s) => s.id === selectedId);
      if (sel) {
        drawSelectionOverlay(ctx, sel);
      }
    }
  }

  function drawShape(context, shape) {
    context.save();
    switch (shape.type) {
      case 'arrow':
        drawSkitchArrow(context, shape);
        break;
      case 'rect':
        drawSkitchRect(context, shape);
        break;
      case 'ellipse':
        drawSkitchEllipse(context, shape);
        break;
      case 'text':
        drawSkitchText(context, shape);
        break;
      case 'mosaic':
        drawMosaic(context, shape);
        break;
      case 'pen':
        drawSkitchPen(context, shape);
        break;
    }
    context.restore();
  }

  /**
   * Skitch風の先太り＆白縁＋ドロップシャドウ付き矢印を描画
   */
  function drawSkitchArrow(context, shape) {
    const { x1, y1, x2, y2, color, size } = shape;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const dist = Math.hypot(dx, dy);
    if (dist < 2) return;

    const unit = getBaseUnit();
    const scale = (SIZE_SCALE[size] || 1.0) * unit;
    const angle = Math.atan2(dy, dx);

    // Skitch特有のシルエット（細い根元 → 太くなるシャフト → くびれ → 大きく開いた矢じり）
    const headLen = Math.min(dist * 0.6, 42 * scale);
    const headWing = Math.min(dist * 0.48, 23 * scale);
    const neckX = dist - headLen * 0.78;
    const neckHalfW = Math.min(headWing * 0.45, 9 * scale);
    const tailHalfW = Math.max(2.2, 3.2 * scale);

    context.translate(x1, y1);
    context.rotate(angle);

    context.beginPath();
    // 根元の丸み
    context.arc(0, 0, tailHalfW, Math.PI * 0.5, Math.PI * 1.5, false);
    // 上側シャフト → 首 → 上の翼 → 先端 → 下の翼 → 首 → 下側シャフト
    context.lineTo(neckX, -neckHalfW);
    context.lineTo(dist - headLen, -headWing);
    context.lineTo(dist, 0);
    context.lineTo(dist - headLen, headWing);
    context.lineTo(neckX, neckHalfW);
    context.closePath();

    // 1. ドロップシャドウ付きの白い外縁
    context.shadowColor = 'rgba(0, 0, 0, 0.45)';
    context.shadowBlur = 8 * unit;
    context.shadowOffsetY = 2.5 * unit;

    context.lineJoin = 'round';
    context.lineCap = 'round';
    context.lineWidth = 7 * scale;
    context.strokeStyle = getOutlineColor(color);
    context.stroke();

    // 2. 内側のメインカラー塗りつぶし
    context.shadowColor = 'transparent';
    context.fillStyle = color;
    context.fill();
  }

  /**
   * Skitch風の白縁＋影付き四角枠
   */
  function drawSkitchRect(context, shape) {
    const x = Math.min(shape.x1, shape.x2);
    const y = Math.min(shape.y1, shape.y2);
    const w = Math.abs(shape.x2 - shape.x1);
    const h = Math.abs(shape.y2 - shape.y1);
    if (w < 2 && h < 2) return;

    const unit = getBaseUnit();
    const scale = (SIZE_SCALE[shape.size] || 1.0) * unit;
    const innerWidth = 6.5 * scale;
    const outerWidth = innerWidth + 6.5 * scale;
    const radius = Math.min(8 * scale, w / 4, h / 4);

    roundRect(context, x, y, w, h, radius);

    // 外側の白縁＋影
    context.shadowColor = 'rgba(0, 0, 0, 0.42)';
    context.shadowBlur = 8 * unit;
    context.shadowOffsetY = 2 * unit;
    context.lineJoin = 'round';
    context.lineWidth = outerWidth;
    context.strokeStyle = getOutlineColor(shape.color);
    context.stroke();

    // 内側の色枠線
    context.shadowColor = 'transparent';
    context.lineWidth = innerWidth;
    context.strokeStyle = shape.color;
    context.stroke();
  }

  /**
   * Skitch風の白縁＋影付き丸・楕円枠
   */
  function drawSkitchEllipse(context, shape) {
    const cx = (shape.x1 + shape.x2) / 2;
    const cy = (shape.y1 + shape.y2) / 2;
    const rx = Math.abs(shape.x2 - shape.x1) / 2;
    const ry = Math.abs(shape.y2 - shape.y1) / 2;
    if (rx < 2 && ry < 2) return;

    const unit = getBaseUnit();
    const scale = (SIZE_SCALE[shape.size] || 1.0) * unit;
    const innerWidth = 6.5 * scale;
    const outerWidth = innerWidth + 6.5 * scale;

    context.beginPath();
    context.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);

    // 外側の白縁＋影
    context.shadowColor = 'rgba(0, 0, 0, 0.42)';
    context.shadowBlur = 8 * unit;
    context.shadowOffsetY = 2 * unit;
    context.lineWidth = outerWidth;
    context.strokeStyle = getOutlineColor(shape.color);
    context.stroke();

    // 内側の色枠線
    context.shadowColor = 'transparent';
    context.lineWidth = innerWidth;
    context.strokeStyle = shape.color;
    context.stroke();
  }

  /**
   * Skitch風の白縁＋影付きフリーハンドペン
   */
  function drawSkitchPen(context, shape) {
    const pts = shape.points;
    if (!pts || pts.length < 2) return;

    const unit = getBaseUnit();
    const scale = (SIZE_SCALE[shape.size] || 1.0) * unit;
    const innerWidth = 6 * scale;
    const outerWidth = innerWidth + 6 * scale;

    context.beginPath();
    context.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      const midX = (pts[i - 1].x + pts[i].x) / 2;
      const midY = (pts[i - 1].y + pts[i].y) / 2;
      context.quadraticCurveTo(pts[i - 1].x, pts[i - 1].y, midX, midY);
    }
    context.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);

    context.lineCap = 'round';
    context.lineJoin = 'round';

    // 外側の白縁＋影
    context.shadowColor = 'rgba(0, 0, 0, 0.4)';
    context.shadowBlur = 6 * unit;
    context.shadowOffsetY = 2 * unit;
    context.lineWidth = outerWidth;
    context.strokeStyle = getOutlineColor(shape.color);
    context.stroke();

    // 内側のメインカラー
    context.shadowColor = 'transparent';
    context.lineWidth = innerWidth;
    context.strokeStyle = shape.color;
    context.stroke();
  }

  /**
   * Skitch風の白縁＋影付き太字テキスト
   */
  function getTextMetricsBox(context, shape) {
    const unit = getBaseUnit();
    const scale = (SIZE_SCALE[shape.size] || 1.0) * unit;
    const fontSize = Math.round(34 * scale);
    const lineHeight = fontSize * 1.25;

    context.save();
    context.font = `900 ${fontSize}px -apple-system, BlinkMacSystemFont, "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif`;
    const lines = (shape.text || '').split('\n');
    let maxW = 0;
    for (const line of lines) {
      const m = context.measureText(line);
      if (m.width > maxW) maxW = m.width;
    }
    context.restore();

    return {
      x: shape.x,
      y: shape.y,
      width: Math.max(20, maxW),
      height: Math.max(fontSize, lines.length * lineHeight),
      fontSize,
      lineHeight,
      lines,
      scale,
      unit
    };
  }

  function drawSkitchText(context, shape) {
    const box = getTextMetricsBox(context, shape);
    const { fontSize, lineHeight, lines, scale, unit } = box;

    context.font = `900 ${fontSize}px -apple-system, BlinkMacSystemFont, "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif`;
    context.textBaseline = 'top';
    context.lineJoin = 'round';
    context.lineCap = 'round';
    context.miterLimit = 2;

    // 外側の白い太縁取り＋ドロップシャドウ
    context.shadowColor = 'rgba(0, 0, 0, 0.5)';
    context.shadowBlur = 8 * unit;
    context.shadowOffsetY = 2.5 * unit;
    context.lineWidth = 8.5 * scale;
    context.strokeStyle = getOutlineColor(shape.color);

    lines.forEach((line, idx) => {
      context.strokeText(line, shape.x, shape.y + idx * lineHeight);
    });

    // 内側の文字塗りつぶし
    context.shadowColor = 'transparent';
    context.fillStyle = shape.color;
    lines.forEach((line, idx) => {
      context.fillText(line, shape.x, shape.y + idx * lineHeight);
    });
  }

  /**
   * 選択範囲のピクセルモザイク処理
   */
  function drawMosaic(context, shape) {
    if (!baseImage) return;
    const rx = Math.max(0, Math.min(shape.x1, shape.x2));
    const ry = Math.max(0, Math.min(shape.y1, shape.y2));
    const rw = Math.min(canvas.width - rx, Math.abs(shape.x2 - shape.x1));
    const rh = Math.min(canvas.height - ry, Math.abs(shape.y2 - shape.y1));
    if (rw < 4 || rh < 4) return;

    const unit = getBaseUnit();
    const scale = (SIZE_SCALE[shape.size] || 1.0) * unit;
    const blockSize = Math.max(6, Math.round(14 * scale));

    const smallW = Math.max(1, Math.ceil(rw / blockSize));
    const smallH = Math.max(1, Math.ceil(rh / blockSize));

    mosaicBufferCanvas.width = smallW;
    mosaicBufferCanvas.height = smallH;

    // 1. 現在のキャンバス（または元画像）の該当領域を極小サイズに縮小描画
    mosaicBufferCtx.imageSmoothingEnabled = true;
    mosaicBufferCtx.clearRect(0, 0, smallW, smallH);
    mosaicBufferCtx.drawImage(baseImage, rx, ry, rw, rh, 0, 0, smallW, smallH);

    // 2. 補間（ぼかし）を切って元のサイズへ拡大描画し、くっきりしたブロックモザイクにする
    const prevSmoothing = context.imageSmoothingEnabled;
    context.imageSmoothingEnabled = false;
    context.drawImage(mosaicBufferCanvas, 0, 0, smallW, smallH, rx, ry, rw, rh);
    context.imageSmoothingEnabled = prevSmoothing;
  }

  // --- 選択枠・ハンドル（つまみ）の描画と当たり判定 ---
  function getShapeHandles(shape) {
    if (shape.type === 'arrow') {
      return [
        { name: 'start', x: shape.x1, y: shape.y1 },
        { name: 'end', x: shape.x2, y: shape.y2 }
      ];
    }
    if (shape.type === 'rect' || shape.type === 'ellipse' || shape.type === 'mosaic') {
      return [
        { name: 'nw', x: shape.x1, y: shape.y1 },
        { name: 'ne', x: shape.x2, y: shape.y1 },
        { name: 'se', x: shape.x2, y: shape.y2 },
        { name: 'sw', x: shape.x1, y: shape.y2 }
      ];
    }
    return [];
  }

  function drawSelectionOverlay(context, shape) {
    context.save();
    const unit = getBaseUnit();

    // テキストやペンの場合はバウンディングボックスを破線で表示
    if (shape.type === 'text' || shape.type === 'pen' || shape.type === 'mosaic' || shape.type === 'rect' || shape.type === 'ellipse') {
      const b = getBoundingBox(shape);
      const pad = 6 * unit;
      context.strokeStyle = '#00B8FF';
      context.lineWidth = 2 * unit;
      context.setLineDash([6 * unit, 4 * unit]);
      context.strokeRect(b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2);
      context.setLineDash([]);
    }

    // リサイズ用ハンドル（丸いつまみ）を描画
    const handles = getShapeHandles(shape);
    const radius = 7.5 * unit;
    for (const h of handles) {
      context.beginPath();
      context.arc(h.x, h.y, radius, 0, Math.PI * 2);
      context.fillStyle = '#FFFFFF';
      context.shadowColor = 'rgba(0, 0, 0, 0.45)';
      context.shadowBlur = 4 * unit;
      context.fill();
      context.shadowColor = 'transparent';
      context.lineWidth = 2.5 * unit;
      context.strokeStyle = '#00B8FF';
      context.stroke();
    }

    context.restore();
  }

  function getBoundingBox(shape) {
    if (shape.type === 'text') {
      const m = getTextMetricsBox(ctx, shape);
      return { x: m.x, y: m.y, w: m.width, h: m.height };
    }
    if (shape.type === 'pen') {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of shape.points) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
      return { x: minX, y: minY, w: Math.max(10, maxX - minX), h: Math.max(10, maxY - minY) };
    }
    const x = Math.min(shape.x1, shape.x2);
    const y = Math.min(shape.y1, shape.y2);
    const w = Math.abs(shape.x2 - shape.x1);
    const h = Math.abs(shape.y2 - shape.y1);
    return { x, y, w, h };
  }

  function hitTestHandles(shape, pos) {
    const unit = getBaseUnit();
    const hitRadius = 14 * unit;
    const handles = getShapeHandles(shape);
    for (const h of handles) {
      if (Math.hypot(pos.x - h.x, pos.y - h.y) <= hitRadius) {
        return h.name;
      }
    }
    return null;
  }

  function findTopShapeAt(pos) {
    for (let i = shapes.length - 1; i >= 0; i--) {
      if (hitTestShape(shapes[i], pos)) {
        return shapes[i];
      }
    }
    return null;
  }

  function hitTestShape(shape, pos) {
    const unit = getBaseUnit();
    const scale = (SIZE_SCALE[shape.size] || 1.0) * unit;
    const tolerance = 14 * scale;

    if (shape.type === 'arrow') {
      return distToSegment(pos, { x: shape.x1, y: shape.y1 }, { x: shape.x2, y: shape.y2 }) <= tolerance * 1.4;
    }

    if (shape.type === 'rect') {
      const b = getBoundingBox(shape);
      const outer = pos.x >= b.x - tolerance && pos.x <= b.x + b.w + tolerance && pos.y >= b.y - tolerance && pos.y <= b.y + b.h + tolerance;
      const inner = pos.x >= b.x + tolerance && pos.x <= b.x + b.w - tolerance && pos.y >= b.y + tolerance && pos.y <= b.y + b.h - tolerance;
      return outer && !inner;
    }

    if (shape.type === 'ellipse') {
      const cx = (shape.x1 + shape.x2) / 2;
      const cy = (shape.y1 + shape.y2) / 2;
      const rx = Math.max(1, Math.abs(shape.x2 - shape.x1) / 2);
      const ry = Math.max(1, Math.abs(shape.y2 - shape.y1) / 2);
      const normDist = Math.hypot((pos.x - cx) / rx, (pos.y - cy) / ry);
      const tolRatio = tolerance / Math.min(rx, ry);
      return Math.abs(normDist - 1) <= Math.max(0.18, tolRatio);
    }

    if (shape.type === 'mosaic' || shape.type === 'text') {
      const b = getBoundingBox(shape);
      return pos.x >= b.x - tolerance * 0.5 && pos.x <= b.x + b.w + tolerance * 0.5 && pos.y >= b.y - tolerance * 0.5 && pos.y <= b.y + b.h + tolerance * 0.5;
    }

    if (shape.type === 'pen') {
      const pts = shape.points;
      for (let i = 1; i < pts.length; i++) {
        if (distToSegment(pos, pts[i - 1], pts[i]) <= tolerance) {
          return true;
        }
      }
      return false;
    }

    return false;
  }

  function distToSegment(p, v, w) {
    const l2 = (w.x - v.x) ** 2 + (w.y - v.y) ** 2;
    if (l2 === 0) return Math.hypot(p.x - v.x, p.y - v.y);
    let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p.x - (v.x + t * (w.x - v.x)), p.y - (v.y + t * (w.y - v.y)));
  }

  function updateCursor() {
    if (currentTool === 'select') {
      canvas.style.cursor = 'default';
    } else if (currentTool === 'text') {
      canvas.style.cursor = 'text';
    } else {
      canvas.style.cursor = 'crosshair';
    }
  }

  function updateHoverCursor(pos) {
    if (selectedId) {
      const sel = shapes.find((s) => s.id === selectedId);
      if (sel && hitTestHandles(sel, pos)) {
        canvas.style.cursor = 'pointer';
        return;
      }
    }
    const hit = findTopShapeAt(pos);
    if (currentTool === 'select') {
      canvas.style.cursor = hit ? 'move' : 'default';
    } else if (selectedId && hit && hit.id === selectedId) {
      canvas.style.cursor = 'move';
    } else {
      updateCursor();
    }
  }

  // --- Undo / Redo / 削除 / 全消去 / 保存 ---
  function saveHistory() {
    undoStack.push(JSON.stringify(shapes));
    if (undoStack.length > 40) undoStack.shift();
    redoStack = [];
    updateToolbarState();
  }

  function undo() {
    if (undoStack.length === 0) return;
    commitTextIfOpen();
    redoStack.push(JSON.stringify(shapes));
    shapes = JSON.parse(undoStack.pop());
    if (selectedId && !shapes.some((s) => s.id === selectedId)) {
      selectedId = null;
    }
    updateToolbarState();
    render();
  }

  function redo() {
    if (redoStack.length === 0) return;
    commitTextIfOpen();
    undoStack.push(JSON.stringify(shapes));
    shapes = JSON.parse(redoStack.pop());
    updateToolbarState();
    render();
  }

  function deleteSelectedShape() {
    if (!selectedId) return;
    saveHistory();
    shapes = shapes.filter((s) => s.id !== selectedId);
    selectedId = null;
    updateToolbarState();
    render();
  }

  function clearAllShapes() {
    if (shapes.length === 0) return;
    commitTextIfOpen();
    saveHistory();
    shapes = [];
    selectedId = null;
    updateToolbarState();
    render();
  }

  function exportImage() {
    if (!baseImage) return;
    commitTextIfOpen();

    // 選択枠・ハンドルを非表示にしてクリーンな状態でレンダリング
    render(false);

    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${currentFileName}-skitch.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      // 選択枠表示を戻す
      render(true);
    }, 'image/png');
  }

  function updateToolbarState() {
    const hasImage = Boolean(baseImage);
    btnUndo.disabled = !hasImage || undoStack.length === 0;
    btnRedo.disabled = !hasImage || redoStack.length === 0;
    btnDelete.disabled = !hasImage || !selectedId;
    btnClear.disabled = !hasImage || shapes.length === 0;
    btnSave.disabled = !hasImage;
  }

  function showLoading(msg) {
    loadingMessage.textContent = msg || '処理中...';
    loadingOverlay.classList.remove('hidden');
  }

  function hideLoading() {
    loadingOverlay.classList.add('hidden');
  }

  // 起動
  init();
})();
