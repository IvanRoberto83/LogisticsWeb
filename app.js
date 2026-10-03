import { db } from "./firebase-config.js";
import {
  collection,
  addDoc,
  doc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  where,
  getDocs,
  increment,
  serverTimestamp,
} from "";

const SEMBAKO_CATEGORIES = [
  "Beras",
  "Minyak Goreng",
  "Gula",
  "Mie Instan",
  "Telur",
  "Daging Kaleng",
  "Kecap",
  "Bumbu Dapur",
  "Susu",
  "Lain-lain",
];
const FASILITAS_CATEGORIES = [
  "Kursi Roda",
  "Tempat Tidur",
  "Alat Bantu Jalan",
  "Perabotan",
  "Elektronik",
  "Lain-lain",
];
const KESEHATAN_CATEGORIES = [
  "Obat",
  "Vitamin",
  "Popok Dewasa",
  "P3K",
  "Alat Medis / Cek Kesehatan",
  "Minyak Angin & Balsem",
  "Sanitasi & Masker",
  "Lain-lain",
];
const UNITS = [
  "kg",
  "liter",
  "pcs",
  "kwintal",
  "unit",
  "paket",
  "box",
  "botol",
  "kaleng",
];
const KONDISI = ["Baik", "Perlu Perbaikan", "Rusak"];
const LOW_STOCK = {
  kg: 5,
  liter: 1,
  pcs: 10,
  kwintal: 1,
  unit: 0,
  paket: 2,
  box: 2,
  botol: 2,
  kaleng: 5,
};

function getGroupColor(group) {
  if (group === "sembako") return "var(--orange)";
  if (group === "fasilitas") return "var(--purple)";
  if (group === "kesehatan") return "var(--blue)";
  return "var(--ink)";
}

function getGroupLabel(group) {
  if (group === "sembako") return "Sembako";
  if (group === "fasilitas") return "Fasilitas";
  if (group === "kesehatan") return "Kesehatan";
  return "Semua";
}

let items = [];
let transactions = [];
let currentTab = "dashboard";

const contentEl = document.getElementById("app-content");
const navDesktopEl = document.getElementById("nav-tabs-desktop");
const navMobileEl = document.getElementById("nav-tabs-mobile");
const modalRoot = document.getElementById("modal-root");
const toastEl = document.getElementById("toast");

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function fmtDate(d) {
  if (!d || d === "-") return "-";
  const dt = new Date(d + "T00:00:00");
  if (isNaN(dt.getTime())) return "-";
  return dt.toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}
function esc(s) {
  return String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}

function getItemSifat(group, item) {
  if (item && item.sifat) return item.sifat;
  return group === "fasilitas" ? "Tidak habis pakai" : "Habis pakai";
}

function getItemLastTx(itemId) {
  if (!itemId) return null;
  return transactions.find((t) => t.itemId === itemId) || null;
}

function loadScriptOnce(src) {
  if (document.querySelector(`script[src="${src}"]`)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Gagal memuat ${src}`));
    document.head.appendChild(s);
  });
}

function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.remove("hidden");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toastEl.classList.add("hidden"), 2500);
}

// ---------- Firestore realtime listeners ----------
onSnapshot(
  collection(db, "items"),
  (snap) => {
    items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    render();
  },
  (err) => showToast("Gagal memuat data barang: " + err.message),
);

onSnapshot(
  query(collection(db, "transactions"), orderBy("createdAt", "desc")),
  (snap) => {
    transactions = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    render();
  },
  (err) => showToast("Gagal memuat transaksi: " + err.message),
);

// ---------- CRUD ----------
async function addItem(data) {
  try {
    await addDoc(collection(db, "items"), {
      ...data,
      stock: Number(data.stock) || 0,
      createdAt: serverTimestamp(),
    });
    showToast(`"${data.name}" ditambahkan ke daftar.`);
  } catch (e) {
    showToast("Gagal menyimpan barang: " + e.message);
  }
}

async function deleteItem(id) {
  const q = query(collection(db, "transactions"), where("itemId", "==", id));
  const snap = await getDocs(q);
  if (!snap.empty) {
    showToast("Tidak bisa dihapus, item ini punya riwayat transaksi.");
    return;
  }
  await deleteDoc(doc(db, "items", id));
}

async function updateItem(id, data) {
  try {
    await updateDoc(doc(db, "items", id), {
      ...data,
      stock: Number(data.stock) || 0,
    });
    showToast(`"${data.name}" diperbarui.`);
  } catch (e) {
    showToast("Gagal memperbarui barang: " + e.message);
  }
}

async function addTransaction(tx) {
  const item = items.find((i) => i.id === tx.itemId);
  if (!item) return;
  const qty = Number(tx.qty);
  const delta = tx.type === "masuk" ? qty : -qty;
  try {
    const itemUpdates = { stock: increment(delta) };
    if (tx.expiryDate && tx.type === "masuk") {
      itemUpdates.expiryDate = tx.expiryDate;
    }
    await updateDoc(doc(db, "items", item.id), itemUpdates);
    await addDoc(collection(db, "transactions"), {
      ...tx,
      qty,
      itemName: item.name,
      unit: item.unit,
      category: item.category,
      group: item.group,
      createdAt: serverTimestamp(),
    });
    showToast(
      tx.type === "masuk" ? "Barang masuk dicatat." : "Barang keluar dicatat.",
    );
  } catch (e) {
    showToast("Gagal mencatat transaksi: " + e.message);
  }
}

async function deleteTransaction(txId) {
  const tx = transactions.find((t) => t.id === txId);
  if (!tx) return;
  const delta = tx.type === "masuk" ? -tx.qty : tx.qty;
  try {
    if (tx.itemId)
      await updateDoc(doc(db, "items", tx.itemId), { stock: increment(delta) });
    await deleteDoc(doc(db, "transactions", txId));
    showToast("Transaksi dihapus, stok disesuaikan kembali.");
  } catch (e) {
    showToast("Gagal menghapus transaksi: " + e.message);
  }
}

async function updateTransaction(txId, newTx) {
  const oldTx = transactions.find((t) => t.id === txId);
  const newItem = items.find((i) => i.id === newTx.itemId);
  if (!oldTx || !newItem) return;

  const oldDelta = oldTx.type === "masuk" ? -oldTx.qty : oldTx.qty;
  const newQty = Number(newTx.qty);
  const newDelta = newTx.type === "masuk" ? newQty : -newQty;

  try {
    if (oldTx.itemId === newTx.itemId) {
      await updateDoc(doc(db, "items", oldTx.itemId), {
        stock: increment(oldDelta + newDelta),
      });
    } else {
      if (oldTx.itemId)
        await updateDoc(doc(db, "items", oldTx.itemId), {
          stock: increment(oldDelta),
        });
      await updateDoc(doc(db, "items", newTx.itemId), {
        stock: increment(newDelta),
      });
    }
    await updateDoc(doc(db, "transactions", txId), {
      itemId: newTx.itemId,
      group: newItem.group,
      type: newTx.type,
      qty: newQty,
      itemName: newItem.name,
      unit: newItem.unit,
      category: newItem.category,
      date: newTx.date,
      expiryDate: newTx.expiryDate || null,
      party: newTx.party,
      note: newTx.note,
    });
    showToast("Transaksi diperbarui.");
  } catch (e) {
    showToast("Gagal memperbarui transaksi: " + e.message);
  }
}

// ---------- Nav ----------
const TABS = [
  {
    id: "dashboard",
    label: "Beranda",
    icon: "M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  },
  {
    id: "sembako",
    label: "Sembako",
    icon: "M6 8h12l1 12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1L6 8Z M6 8l2-4h8l2 4 M9 12h6",
  },
  {
    id: "fasilitas",
    label: "Fasilitas",
    icon: "M4 18v-6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v6M4 18h16M4 18v2M20 18v2M6 10V7a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v3",
  },
  {
    id: "kesehatan",
    label: "Kesehatan",
    icon: "M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z M12 9v6 M9 12h6",
  },
  {
    id: "laporan",
    label: "Laporan",
    icon: "M6 3h9l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm9 0v5h5M9 13h6M9 17h6M9 9h2",
  },
];

function renderNav() {
  navDesktopEl.innerHTML = TABS.map(
    (t) => `
    <button data-tab="${t.id}" class="nav-btn-desktop ${currentTab === t.id ? "active" : ""} flex items-center gap-2.5 px-5 py-3.5 text-sm font-medium transition-colors">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${t.icon}"/></svg>
      ${t.label}
    </button>`,
  ).join("");

  navMobileEl.innerHTML = TABS.map(
    (t) => `
    <button data-tab="${t.id}" class="nav-btn-mobile ${currentTab === t.id ? "active" : ""} flex-1 flex flex-col items-center justify-center gap-0.5 py-2 px-1 text-[10px] sm:text-[11px] font-medium transition-colors">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${t.icon}"/></svg>
      <span class="truncate max-w-[64px] sm:max-w-none text-center leading-tight">${t.label}</span>
    </button>`,
  ).join("");

  [navDesktopEl, navMobileEl].forEach((navEl) => {
    navEl.querySelectorAll("[data-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        currentTab = btn.dataset.tab;
        contentEl.scrollTop = 0;
        render();
      });
    });
  });
}

// ---------- Render dispatcher ----------
function render() {
  renderNav();
  if (currentTab === "dashboard") renderDashboard();
  else if (currentTab === "sembako")
    renderStockSection("sembako", "Sembako", SEMBAKO_CATEGORIES);
  else if (currentTab === "fasilitas")
    renderStockSection("fasilitas", "Fasilitas", FASILITAS_CATEGORIES);
  else if (currentTab === "kesehatan")
    renderStockSection("kesehatan", "Kesehatan", KESEHATAN_CATEGORIES);
  else if (currentTab === "laporan") renderLaporan();
}

function stampHtml(type) {
  return `<span class="stamp stamp-${type} text-[10px] font-semibold tracking-wider uppercase px-2.5 py-0.5 rounded shadow-sm whitespace-nowrap">${type === "masuk" ? "Masuk" : "Keluar"}</span>`;
}

// ---------- Dashboard ----------
function renderDashboard() {
  const sembako = items.filter((i) => i.group === "sembako");
  const fasilitas = items.filter((i) => i.group === "fasilitas");
  const kesehatan = items.filter((i) => i.group === "kesehatan");
  const today = todayStr();
  const todayTx = transactions.filter((t) => t.date === today);
  const lowStock = items.filter(
    (i) =>
      i.group !== "fasilitas" && i.stock <= (LOW_STOCK[i.unit] ?? Infinity),
  );
  const recent = transactions.slice(0, 8);

  const stats = [
    {
      label: "Jenis sembako",
      value: sembako.length,
      color: "var(--orange)",
      bg: "rgba(221, 92, 41, 0.18)",
      border: "rgba(221, 92, 41, 0.5)",
      labelColor: "#C2410C",
    },
    {
      label: "Jenis fasilitas",
      value: fasilitas.length,
      color: "var(--purple)",
      bg: "rgba(124, 58, 237, 0.18)",
      border: "rgba(124, 58, 237, 0.5)",
      labelColor: "#6D28D9",
    },
    {
      label: "Jenis kesehatan",
      value: kesehatan.length,
      color: "var(--blue)",
      bg: "rgba(37, 99, 235, 0.18)",
      border: "rgba(37, 99, 235, 0.5)",
      labelColor: "#1D4ED8",
    },
    {
      label: "Transaksi hari ini",
      value: todayTx.length,
      color: "var(--ink)",
      bg: "rgba(255, 255, 255, 0.65)",
      border: "var(--rule)",
      labelColor: "var(--ink-soft)",
    },
    {
      label: "Stok menipis",
      value: lowStock.length,
      warn: lowStock.length > 0,
      color: lowStock.length > 0 ? "var(--red)" : "var(--ink)",
      bg:
        lowStock.length > 0
          ? "rgba(197, 48, 48, 0.08)"
          : "rgba(255, 255, 255, 0.65)",
      border: lowStock.length > 0 ? "rgba(197, 48, 48, 0.3)" : "var(--rule)",
      labelColor: lowStock.length > 0 ? "var(--red)" : "var(--ink-soft)",
    },
  ];

  contentEl.innerHTML = `
    <div class="flex items-start justify-between flex-wrap gap-3 mb-5">
      <div>
        <h2 class="serif text-2xl font-bold" style="color:var(--ink)">Ringkasan Hari Ini</h2>
        <p class="text-sm mt-0.5" style="color:var(--ink-soft)">Diperbarui ${fmtDate(today)}</p>
      </div>
      <button id="btn-dash-upload-excel" class="text-xs sm:text-sm font-medium px-3 sm:px-3.5 py-2 rounded shadow-sm flex items-center justify-center gap-1.5 whitespace-nowrap" style="background:var(--blue);color:#fff">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
        Upload Excel
      </button>
    </div>
    <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
      ${stats
        .map(
          (s, idx) => `
        <div class="rounded-md p-3.5 transition-all shadow-sm ${idx === 4 ? "col-span-2 sm:col-span-1" : ""}" style="background:${s.bg};border:1px solid ${s.border}">
          <p class="text-xs mb-1 font-medium" style="color:${s.labelColor}">${s.label}</p>
          <p class="mono text-2xl font-bold" style="color:${s.color}">${s.value}</p>
        </div>`,
        )
        .join("")}
    </div>
    ${
      lowStock.length > 0
        ? `
      <div class="rounded-md p-4 mb-6 rule-all" style="background:rgba(255,255,255,0.5)">
        <div class="flex items-center gap-2 mb-2" style="color:var(--red)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg>
          <p class="text-sm font-semibold">Stok menipis (${lowStock.length} barang)</p>
        </div>
        <div class="flex flex-wrap gap-2">
          ${lowStock.map((i) => `<span class="mono text-xs px-2 py-1 rounded" style="background:#F3E4DE;color:var(--red)">${esc(i.name)} (${getGroupLabel(i.group)}): ${i.stock} ${esc(i.unit)}</span>`).join("")}
        </div>
      </div>`
        : ""
    }
    <p class="serif font-bold mb-3" style="color:var(--ink)">Transaksi terbaru</p>
    ${
      recent.length === 0
        ? `<p class="text-sm" style="color:var(--ink-soft)">Belum ada transaksi tercatat.</p>`
        : `
      <div class="space-y-2">
        ${recent
          .map(
            (t) => `
          <div class="flex items-center justify-between gap-3 text-sm py-2 rule-b">
            <div class="flex items-center gap-2 sm:gap-3 flex-wrap min-w-0 flex-1">
              ${stampHtml(t.type)}
              <span class="font-medium" style="color:var(--ink)">${esc(t.itemName)}</span>
              <span style="color:var(--ink-soft)">${t.qty} ${esc(t.unit)}</span>
            </div>
            <span class="mono text-xs shrink-0" style="color:var(--ink-soft)">${fmtDate(t.date)}</span>
          </div>`,
          )
          .join("")}
      </div>`
    }
  `;

  document
    .getElementById("btn-dash-upload-excel")
    .addEventListener("click", () => openImportExcelModal("sembako"));
}

// ---------- Stock section (Sembako / Fasilitas / Kesehatan) ----------
function renderStockSection(group, title, categories) {
  const isFasilitas = group === "fasilitas";
  const isConsumable = group !== "fasilitas";
  const groupItems = items.filter((i) => i.group === group);
  const groupTx = transactions.filter((t) => t.group === group);

  contentEl.innerHTML = `
    <div class="flex flex-col sm:flex-row sm:items-start justify-between gap-3 mb-5">
      <div>
        <h2 class="serif text-2xl font-bold" style="color:var(--ink)">${title}</h2>
        <p class="text-sm mt-0.5" style="color:var(--ink-soft)">${groupItems.length} jenis barang tercatat</p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <button id="btn-open-tx-masuk" class="flex-1 sm:flex-initial text-xs sm:text-sm font-medium px-3 sm:px-3.5 py-2 rounded shadow-sm flex items-center justify-center gap-1.5 whitespace-nowrap" style="background:var(--green);color:#fff">+ Catat <span class="hidden sm:inline">Barang</span> Masuk</button>
        <button id="btn-open-tx-keluar" class="flex-1 sm:flex-initial text-xs sm:text-sm font-medium px-3 sm:px-3.5 py-2 rounded shadow-sm flex items-center justify-center gap-1.5 whitespace-nowrap" style="background:var(--red);color:#fff">+ Catat <span class="hidden sm:inline">Barang</span> Keluar</button>
        <button id="btn-open-item" class="w-full sm:w-auto text-xs sm:text-sm font-medium px-3 sm:px-3.5 py-2 rounded shadow-sm flex items-center justify-center whitespace-nowrap" style="background:var(--ink);color:#fff">+ Tambah Barang<span class="hidden sm:inline"> Baru</span></button>
        <button id="btn-upload-excel" class="w-full sm:w-auto text-xs sm:text-sm font-medium px-3 sm:px-3.5 py-2 rounded shadow-sm flex items-center justify-center gap-1.5 whitespace-nowrap" style="background:var(--blue);color:#fff">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          Upload Excel
        </button>
      </div>
    </div>
    <div class="relative mb-4 w-full sm:max-w-xs">
      <input id="search-box" placeholder="Cari barang..." class="w-full border rounded pl-3 pr-3 py-2 text-sm bg-white/50" />
    </div>
    <div id="item-list" class="space-y-2 mb-8"></div>
    <p class="serif font-bold mb-3" style="color:var(--ink)">Riwayat transaksi</p>
    <div id="tx-list" class="space-y-2"></div>
  `;

  function paintItems(filterText = "") {
    const filtered = groupItems.filter((i) =>
      i.name.toLowerCase().includes(filterText.toLowerCase()),
    );
    const list = document.getElementById("item-list");
    list.innerHTML =
      filtered.length === 0
        ? `<p class="text-sm" style="color:var(--ink-soft)">Belum ada barang ${title.toLowerCase()} tercatat.</p>`
        : filtered
            .map((i) => {
              const isExpired =
                i.expiryDate &&
                new Date(i.expiryDate + "T23:59:59") < new Date();
              const sifat = getItemSifat(group, i);
              return `
        <div class="stock-row flex items-center justify-between gap-3 py-2.5 text-sm rule-b">
          <div class="stock-main min-w-0 flex-1">
            <div class="flex items-center gap-2 flex-wrap mb-0.5">
              <p class="font-medium text-sm sm:text-base" style="color:var(--ink)">${esc(i.name)}</p>
              <span class="text-[10px] font-medium px-2 py-0.1 rounded-full" style="${sifat === "Habis pakai" ? "background:rgba(221,92,41,0.1);color:var(--orange)" : "background:rgba(124,58,237,0.1);color:var(--purple)"}">${esc(sifat)}</span>
            </div>
            <p class="text-xs flex items-center gap-1.5 flex-wrap" style="color:var(--ink-soft)">
              <span style="color:${getGroupColor(group)}" class="font-medium">${esc(i.category)}</span>
              ${isFasilitas && i.kondisi ? `<span>·</span><span>${esc(i.kondisi)}</span>` : ""}
              ${i.expiryDate ? `<span>·</span><span class="mono text-[11px]" style="color:${isExpired ? "var(--red)" : "var(--ink-soft)"}">Exp: ${fmtDate(i.expiryDate)}${isExpired ? " (Kadaluwarsa)" : ""}</span>` : ""}
            </p>
          </div>
          <div class="stock-actions flex items-center gap-2 sm:gap-3 shrink-0">
            <span class="stock-value mono font-bold text-base sm:text-lg whitespace-nowrap" style="color:${isConsumable && i.stock <= (LOW_STOCK[i.unit] ?? Infinity) ? "var(--red)" : "var(--ink)"}">Stok: ${i.stock} ${esc(i.unit)}</span>
            <button data-edit-item="${i.id}" aria-label="Edit barang" class="mobile-action px-2.5 py-1.5 rounded text-xs sm:text-sm font-semibold transition-colors" style="background:#E5E7EB;color:#374151">Edit</button>
            <button data-del-item="${i.id}" aria-label="Hapus barang" class="mobile-action px-2.5 py-1.5 rounded text-xs sm:text-sm font-semibold transition-colors" style="background:#FEE2E2;color:#DC2626">Hapus</button>
          </div>
        </div>`;
            })
            .join("");

    list.querySelectorAll("[data-del-item]").forEach((b) =>
      b.addEventListener("click", () => {
        const item = groupItems.find((x) => x.id === b.dataset.delItem);
        openConfirmModal(
          `Yakin ingin menghapus "${item ? esc(item.name) : "barang ini"}"? Tindakan ini tidak dapat dibatalkan.`,
          () => deleteItem(b.dataset.delItem),
        );
      }),
    );
    list.querySelectorAll("[data-edit-item]").forEach((b) =>
      b.addEventListener("click", () => {
        const item = groupItems.find((x) => x.id === b.dataset.editItem);
        if (item) openItemModal(group, title, categories, item);
      }),
    );
  }

  document.getElementById("tx-list").innerHTML =
    groupTx.length === 0
      ? `<p class="text-sm" style="color:var(--ink-soft)">Belum ada transaksi.</p>`
      : groupTx
          .slice(0, 15)
          .map(
            (t) => `
      <div class="transaction-row flex items-center justify-between gap-3 text-sm py-2 rule-b">
        <div class="tx-main flex items-center gap-2 sm:gap-3 flex-wrap min-w-0 flex-1">
          ${stampHtml(t.type)}
          <span class="font-medium" style="color:var(--ink)">${esc(t.itemName)}</span>
          <span class="mono text-xs sm:text-sm" style="color:var(--ink-soft)">${t.qty} ${esc(t.unit)}</span>
          ${t.party ? `<span class="text-xs" style="color:var(--ink-soft)">— ${esc(t.party)}</span>` : ""}
          ${t.expiryDate ? `<span class="mono text-[11px] px-1.5 py-0.5 rounded" style="background:rgba(0,0,0,0.04);color:var(--ink-soft)">Exp: ${fmtDate(t.expiryDate)}</span>` : ""}
        </div>
        <div class="tx-actions flex items-center gap-2 sm:gap-3 shrink-0">
          <span class="tx-date mono text-xs" style="color:var(--ink-soft)">${fmtDate(t.date)}</span>
          <button data-edit-tx="${t.id}" aria-label="Edit transaksi" class="mobile-action px-2.5 py-1.5 rounded text-xs sm:text-sm font-semibold transition-colors" style="background:#E5E7EB;color:#374151">Edit</button>
          <button data-del-tx="${t.id}" aria-label="Hapus transaksi" class="mobile-action px-2.5 py-1.5 rounded text-xs sm:text-sm font-semibold transition-colors" style="background:#FEE2E2;color:#DC2626">Hapus</button>
        </div>
      </div>`,
          )
          .join("");
  document
    .getElementById("tx-list")
    .querySelectorAll("[data-del-tx]")
    .forEach((b) =>
      b.addEventListener("click", () => {
        const tx = groupTx.find((x) => x.id === b.dataset.delTx);
        openConfirmModal(
          `Yakin ingin menghapus transaksi "${tx ? esc(tx.itemName) : "ini"}"? Stok akan disesuaikan kembali.`,
          () => deleteTransaction(b.dataset.delTx),
        );
      }),
    );
  document
    .getElementById("tx-list")
    .querySelectorAll("[data-edit-tx]")
    .forEach((b) =>
      b.addEventListener("click", () => {
        const tx = groupTx.find((x) => x.id === b.dataset.editTx);
        if (tx) openTxModal(group, groupItems, tx.type, tx);
      }),
    );

  paintItems();
  document
    .getElementById("search-box")
    .addEventListener("input", (e) => paintItems(e.target.value));
  document
    .getElementById("btn-open-item")
    .addEventListener("click", () => openItemModal(group, title, categories));
  document
    .getElementById("btn-open-tx-masuk")
    .addEventListener("click", () => openTxModal(group, groupItems, "masuk"));
  document
    .getElementById("btn-open-tx-keluar")
    .addEventListener("click", () => openTxModal(group, groupItems, "keluar"));
  document
    .getElementById("btn-upload-excel")
    .addEventListener("click", () => openImportExcelModal(group));
}

// ---------- Modals ----------
function openConfirmModal(message, onConfirm) {
  modalRoot.innerHTML = `
    <div class="fixed inset-0 flex items-center justify-center z-40 p-4" style="background:rgba(0,0,0,0.4)">
      <div class="rounded-md p-5 w-full max-w-sm" style="background:var(--page);border:1px solid var(--rule)">
        <h3 class="serif text-lg font-bold mb-2" style="color:var(--ink)">Konfirmasi hapus</h3>
        <p class="text-sm mb-5" style="color:var(--ink-soft)">${message}</p>
        <div class="flex justify-end gap-2">
          <button id="confirm-cancel" class="text-sm font-medium px-3.5 py-2 rounded" style="background:#E5E7EB;color:var(--ink)">Batal</button>
          <button id="confirm-ok" class="text-sm font-medium px-3.5 py-2 rounded shadow-sm" style="background:var(--red);color:#fff">Ya, hapus</button>
        </div>
      </div>
    </div>`;
  document
    .getElementById("confirm-cancel")
    .addEventListener("click", closeModal);
  document.getElementById("confirm-ok").addEventListener("click", () => {
    closeModal();
    onConfirm();
  });
}
function closeModal() {
  modalRoot.innerHTML = "";
}

function openItemModal(group, title, categories, existingItem = null) {
  const isEdit = !!existingItem;
  const isFasilitas = group === "fasilitas";
  modalRoot.innerHTML = `
    <div class="fixed inset-0 flex items-center justify-center z-30 p-4" style="background:rgba(0,0,0,0.35)">
      <div class="rounded-md p-5 w-full max-w-md max-h-[90vh] overflow-y-auto" style="background:var(--page);border:1px solid var(--rule)">
        <div class="flex items-center justify-between mb-4">
          <h3 class="serif text-lg font-bold" style="color:var(--ink)">${isEdit ? "Edit" : "Tambah"} barang ${title.toLowerCase()}</h3>
          <button id="close-modal" aria-label="Tutup" class="p-1 rounded hover:bg-black/5" style="color:var(--ink-soft)">✕</button>
        </div>
        <form id="item-form" class="space-y-3">
          <label class="block"><span class="text-xs font-medium mb-1 block" style="color:var(--ink-soft)">Nama barang</span>
            <input required id="f-name" placeholder="Tuliskan nama barang" value="${isEdit ? esc(existingItem.name) : ""}" class="w-full border rounded px-3 py-2 text-sm bg-white/70" /></label>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label class="block"><span class="text-xs font-medium mb-1 block" style="color:var(--ink-soft)">Kategori</span>
              <select id="f-category" class="w-full border rounded px-3 py-2 text-sm bg-white/70">${categories.map((c) => `<option ${isEdit && existingItem.category === c ? "selected" : ""}>${c}</option>`).join("")}</select></label>
            <label class="block"><span class="text-xs font-medium mb-1 block" style="color:var(--ink-soft)">Satuan</span>
              <select id="f-unit" class="w-full border rounded px-3 py-2 text-sm bg-white/70">${UNITS.map((u) => `<option ${isEdit && existingItem.unit === u ? "selected" : ""}>${u}</option>`).join("")}</select></label>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label class="block"><span class="text-xs font-medium mb-1 block" style="color:var(--ink-soft)">Stok</span>
              <input type="number" min="0" id="f-stock" placeholder="0" value="${isEdit ? existingItem.stock : ""}" class="w-full border rounded px-3 py-2 text-sm bg-white/70" /></label>
            <label class="block"><span class="text-xs font-medium mb-1 block" style="color:var(--ink-soft)">Tanggal kadaluwarsa (opsional)</span>
              <input type="date" id="f-expiry" value="${isEdit ? existingItem.expiryDate || "" : ""}" class="w-full border rounded px-3 py-2 text-sm bg-white/70" /></label>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label class="block"><span class="text-xs font-medium mb-1 block" style="color:var(--ink-soft)">Sifat barang</span>
              <select id="f-sifat" class="w-full border rounded px-3 py-2 text-sm bg-white/70">
                <option value="Habis pakai" ${(isEdit ? existingItem.sifat || getItemSifat(group, existingItem) : isFasilitas ? "Tidak habis pakai" : "Habis pakai") === "Habis pakai" ? "selected" : ""}>Habis pakai</option>
                <option value="Tidak habis pakai" ${(isEdit ? existingItem.sifat || getItemSifat(group, existingItem) : isFasilitas ? "Tidak habis pakai" : "Habis pakai") === "Tidak habis pakai" ? "selected" : ""}>Tidak habis pakai</option>
              </select></label>
            ${
              isFasilitas
                ? `<label class="block"><span class="text-xs font-medium mb-1 block" style="color:var(--ink-soft)">Kondisi</span>
              <select id="f-kondisi" class="w-full border rounded px-3 py-2 text-sm bg-white/70">${KONDISI.map((k) => `<option ${isEdit && existingItem.kondisi === k ? "selected" : ""}>${k}</option>`).join("")}</select></label>`
                : `<div></div>`
            }
          </div>
          <button type="submit" class="w-full py-2.5 rounded text-sm font-medium mt-2 shadow-sm" style="background:var(--ink);color:#fff">${isEdit ? "Simpan perubahan" : "Simpan barang"}</button>
        </form>
      </div>
    </div>`;
  document.getElementById("close-modal").addEventListener("click", closeModal);
  document.getElementById("item-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = document.getElementById("f-name").value.trim();
    if (!name) return;
    const data = {
      name,
      group,
      category: document.getElementById("f-category").value,
      unit: document.getElementById("f-unit").value,
      stock: document.getElementById("f-stock").value,
      sifat: document.getElementById("f-sifat").value,
      expiryDate: document.getElementById("f-expiry").value || null,
      kondisi: isFasilitas ? document.getElementById("f-kondisi").value : null,
    };
    if (isEdit) await updateItem(existingItem.id, data);
    else await addItem(data);
    closeModal();
  });
}

function openTxModal(
  group,
  groupItems,
  defaultType = "masuk",
  existingTx = null,
) {
  const isEdit = !!existingTx;
  const txType = isEdit ? existingTx.type : defaultType;

  if (groupItems.length === 0) {
    modalRoot.innerHTML = `
      <div class="fixed inset-0 flex items-center justify-center z-30 p-4" style="background:rgba(0,0,0,0.35)">
        <div class="rounded-md p-5 w-full max-w-md" style="background:var(--page);border:1px solid var(--rule)">
          <div class="flex items-center justify-between mb-4">
            <h3 class="serif text-lg font-bold" style="color:var(--ink)">Catat Barang ${txType === "masuk" ? "Masuk" : "Keluar"}</h3>
            <button id="close-modal" style="color:var(--ink-soft)">✕</button>
          </div>
          <p class="text-sm" style="color:var(--ink-soft)">Tambahkan barang dulu sebelum mencatat transaksi.</p>
        </div>
      </div>`;
    document
      .getElementById("close-modal")
      .addEventListener("click", closeModal);
    return;
  }
  modalRoot.innerHTML = `
    <div class="fixed inset-0 flex items-center justify-center z-30 p-4" style="background:rgba(0,0,0,0.35)">
      <div class="rounded-md p-5 w-full max-w-md max-h-[90vh] overflow-y-auto" style="background:var(--page);border:1px solid var(--rule)">
        <div class="flex items-center justify-between mb-4">
          <div class="flex items-center gap-2.5">
            <h3 class="serif text-lg font-bold" style="color:var(--ink)">${isEdit ? "Edit" : "Catat"} Barang ${txType === "masuk" ? "Masuk" : "Keluar"}</h3>
            ${stampHtml(txType)}
          </div>
          <button id="close-modal" aria-label="Tutup" class="p-1 rounded hover:bg-black/5" style="color:var(--ink-soft)">✕</button>
        </div>
        <form id="tx-form" class="space-y-3">
          <input type="hidden" id="tx-type" value="${txType}" />
          <label class="block"><span class="text-xs font-medium mb-1 block" style="color:var(--ink-soft)">Barang</span>
            <select id="tx-item" required class="w-full border rounded px-3 py-2 text-sm bg-white/70">
              <option value="">Pilih barang...</option>
              ${groupItems.map((i) => `<option value="${i.id}" ${isEdit && existingTx.itemId === i.id ? "selected" : ""}>${esc(i.name)} (stok: ${i.stock} ${esc(i.unit)})</option>`).join("")}
            </select></label>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label class="block"><span class="text-xs font-medium mb-1 block" style="color:var(--ink-soft)">Jumlah</span>
              <input type="number" min="1" id="tx-qty" required placeholder="0" value="${isEdit ? existingTx.qty : ""}" class="w-full border rounded px-3 py-2 text-sm bg-white/70" /></label>
            <label class="block"><span class="text-xs font-medium mb-1 block" style="color:var(--ink-soft)">Tanggal kadaluwarsa (opsional)</span>
              <input type="date" id="tx-expiry" value="${isEdit ? existingTx.expiryDate || "" : ""}" class="w-full border rounded px-3 py-2 text-sm bg-white/70" /></label>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label class="block"><span class="text-xs font-medium mb-1 block" style="color:var(--ink-soft)">Tanggal transaksi</span>
              <input type="date" id="tx-date" value="${isEdit ? existingTx.date : todayStr()}" class="w-full border rounded px-3 py-2 text-sm bg-white/70" /></label>
            <label class="block"><span id="tx-party-label" class="text-xs font-medium mb-1 block" style="color:var(--ink-soft)">${txType === "keluar" ? "Tujuan/penerima" : "Donatur/sumber"}</span>
              <input id="tx-party" placeholder="Opsional" value="${isEdit ? esc(existingTx.party || "") : ""}" class="w-full border rounded px-3 py-2 text-sm bg-white/70" /></label>
          </div>
          <label class="block"><span class="text-xs font-medium mb-1 block" style="color:var(--ink-soft)">Catatan</span>
            <input id="tx-note" placeholder="Opsional" value="${isEdit ? esc(existingTx.note || "") : ""}" class="w-full border rounded px-3 py-2 text-sm bg-white/70" /></label>
          <button type="submit" class="w-full py-2.5 rounded text-sm font-medium mt-2 shadow-sm" style="background:${txType === "masuk" ? "var(--green)" : "var(--red)"};color:#fff">${isEdit ? "Simpan perubahan" : `Simpan Barang ${txType === "masuk" ? "Masuk" : "Keluar"}`}</button>
        </form>
      </div>
    </div>`;
  document.getElementById("close-modal").addEventListener("click", closeModal);
  document.getElementById("tx-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const itemId = document.getElementById("tx-item").value;
    const qty = document.getElementById("tx-qty").value;
    if (!itemId || !qty || Number(qty) <= 0) return;
    const txData = {
      itemId,
      group,
      type: document.getElementById("tx-type").value,
      qty,
      date: document.getElementById("tx-date").value,
      expiryDate: document.getElementById("tx-expiry").value || null,
      party: document.getElementById("tx-party").value,
      note: document.getElementById("tx-note").value,
    };
    if (isEdit) await updateTransaction(existingTx.id, txData);
    else await addTransaction(txData);
    closeModal();
  });
}

function isDashInput(v) {
  return typeof v === "string" && /^[-–—]+$/.test(v.trim());
}

function parseExcelDate(val) {
  if (!val) return null;
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return null;
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, "0");
    const d = String(val.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  if (typeof val === "number") {
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    const dt = new Date(excelEpoch.getTime() + val * 86400000);
    if (isNaN(dt.getTime())) return null;
    return dt.toISOString().slice(0, 10);
  }
  const s = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const match = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
  if (match) {
    const d = match[1].padStart(2, "0");
    const m = match[2].padStart(2, "0");
    const y = match[3];
    return `${y}-${m}-${d}`;
  }
  const dt = new Date(s);
  if (!isNaN(dt.getTime())) return dt.toISOString().slice(0, 10);
  return null;
}

async function downloadExcelTemplate() {
  try {
    await loadScriptOnce(
      "https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js",
    );
    const wb = new ExcelJS.Workbook();

    const wsLists = wb.addWorksheet("Lists");
    wsLists.state = "veryHidden";

    const KELOMPOK_OPTIONS = ["Sembako", "Fasilitas", "Kesehatan"];
    const JENIS_OPTIONS = ["Habis Pakai", "Tidak Habis Pakai"];
    const SATUAN_OPTIONS = [
      "kg",
      "liter",
      "pcs",
      "kwintal",
      "unit",
      "paket",
      "box",
      "botol",
      "kaleng",
    ];
    const TIPE_OPTIONS = ["Masuk", "Keluar"];
    const SEMBAKO_CATEGORIES = [
      "Beras",
      "Minyak Goreng",
      "Gula",
      "Mie Instan",
      "Telur",
      "Daging Kaleng",
      "Kecap",
      "Bumbu Dapur",
      "Susu",
      "Lain-lain",
    ];
    const FASILITAS_CATEGORIES = [
      "Kursi Roda",
      "Tempat Tidur",
      "Alat Bantu Jalan",
      "Perabotan",
      "Elektronik",
      "Lain-lain",
    ];
    const KESEHATAN_CATEGORIES = [
      "Obat",
      "Vitamin",
      "Popok Dewasa",
      "P3K",
      "Alat Medis / Cek Kesehatan",
      "Minyak Angin & Balsem",
      "Sanitasi & Masker",
      "Lain-lain",
    ];

    const listColumns = {
      Kelompok: { col: "A", values: KELOMPOK_OPTIONS },
      Sembako: { col: "B", values: SEMBAKO_CATEGORIES },
      Fasilitas: { col: "C", values: FASILITAS_CATEGORIES },
      Kesehatan: { col: "D", values: KESEHATAN_CATEGORIES },
      Jenis: { col: "E", values: JENIS_OPTIONS },
      Satuan: { col: "F", values: SATUAN_OPTIONS },
      Tipe: { col: "G", values: TIPE_OPTIONS },
    };

    Object.entries(listColumns).forEach(([name, { col, values }]) => {
      values.forEach((v, i) => {
        wsLists.getCell(`${col}${i + 1}`).value = v;
      });
      wb.definedNames.add(`Lists!$${col}$1:$${col}$${values.length}`, name);
    });

    const wsPetunjuk = wb.addWorksheet("Petunjuk");
    wsPetunjuk.columns = [{ width: 30 }, { width: 80 }];
    [
      ["Petunjuk Pengisian Template Logistik"],
      [],
      ["Kolom", "Ketentuan"],
      ["Nama Barang", "Wajib diisi, bebas sesuai nama barang"],
      ["Kelompok", "Pilih opsi: Sembako / Fasilitas / Kesehatan"],
      [
        "Kategori",
        "Hanya bisa diisi setelah kolom Kelompok diisi, opsi menyesuaikan Kelompok yang dipilih",
      ],
      ["Jenis", "Pilih opsi: Habis Pakai / Tidak Habis Pakai"],
      ["Stok", "Hanya boleh diisi angka"],
      [
        "Satuan",
        "Pilih opsi: kg, liter, pcs, kwintal, unit, paket, box, botol, kaleng",
      ],
      [
        "Tipe Transaksi",
        'Pilih opsi: Masuk / Keluar (boleh dikosongkan dengan "-")',
      ],
      ["Tanggal Transaksi", 'Boleh dikosongkan dengan "-"'],
      ["Tanggal Kadaluwarsa", 'Boleh dikosongkan dengan "-"'],
      ["Donatur / Penerima", 'Boleh dikosongkan dengan "-"'],
      ["Catatan", 'Boleh dikosongkan dengan "-"'],
    ].forEach((row) => wsPetunjuk.addRow(row));
    wsPetunjuk.getRow(1).font = { bold: true, size: 13 };
    wsPetunjuk.getRow(3).font = { bold: true };

    const wsTemplate = wb.addWorksheet("Template");
    wsTemplate.addRow([
      "Nama Barang",
      "Kelompok",
      "Kategori",
      "Jenis",
      "Stok",
      "Satuan",
      "Tipe Transaksi",
      "Tanggal Transaksi",
      "Tanggal Kadaluwarsa",
      "Donatur / Penerima",
      "Catatan",
    ]);
    wsTemplate.getRow(1).font = { bold: true };
    wsTemplate.columns = [
      { width: 40 },
      { width: 12 },
      { width: 22 },
      { width: 16 },
      { width: 8 },
      { width: 10 },
      { width: 14 },
      { width: 16 },
      { width: 18 },
      { width: 18 },
      { width: 20 },
    ];
    wsTemplate.addRow([
      "Ini contoh, gantilah sesuai barang Anda",
      "Sembako",
      "Beras",
      "Habis Pakai",
      50,
      "kg",
      "Masuk",
      "-",
      "-",
      "-",
      "-",
    ]);

    const LAST_ROW = 500;
    for (let r = 2; r <= LAST_ROW; r++) {
      wsTemplate.getCell(`B${r}`).dataValidation = {
        type: "list",
        allowBlank: true,
        formulae: ["Kelompok"],
        showErrorMessage: true,
        errorTitle: "Pilihan tidak valid",
        error: "Pilih salah satu: Sembako, Fasilitas, atau Kesehatan.",
      };
      wsTemplate.getCell(`C${r}`).dataValidation = {
        type: "list",
        allowBlank: true,
        formulae: [`INDIRECT($B${r})`],
        showErrorMessage: true,
        errorTitle: "Isi Kelompok dahulu",
        error:
          "Pilih Kelompok terlebih dahulu, lalu pilih Kategori sesuai Kelompok tersebut.",
      };
      wsTemplate.getCell(`D${r}`).dataValidation = {
        type: "list",
        allowBlank: true,
        formulae: ["Jenis"],
      };
      wsTemplate.getCell(`F${r}`).dataValidation = {
        type: "list",
        allowBlank: true,
        formulae: ["Satuan"],
      };
      wsTemplate.getCell(`G${r}`).dataValidation = {
        type: "list",
        allowBlank: true,
        formulae: ["Tipe"],
      };
    }

    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "Template_Logistik_YWM.xlsx";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast("Template Excel berhasil diunduh.");
  } catch (e) {
    showToast("Gagal mengunduh template: " + e.message);
  }
}

async function openImportExcelModal(defaultGroup = "sembako") {
  try {
    await loadScriptOnce(
      "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js",
    );
  } catch (e) {
    showToast("Gagal memuat modul Excel: " + e.message);
    return;
  }

  let parsedRows = [];

  modalRoot.innerHTML = `
    <div class="fixed inset-0 flex items-center justify-center z-30 p-4" style="background:rgba(0,0,0,0.35)">
      <div class="rounded-md p-5 w-full max-w-2xl max-h-[90vh] overflow-y-auto" style="background:var(--page);border:1px solid var(--rule)">
        <div class="flex items-center justify-between mb-4">
          <div class="flex items-center gap-2">
            <h3 class="serif text-lg font-bold" style="color:var(--ink)">Upload Data Excel</h3>
            <span class="text-xs px-2 py-0.5 rounded font-medium" style="background:rgba(37,99,235,0.1);color:var(--blue)">.xlsx / .xls / .csv</span>
          </div>
          <button id="close-modal" aria-label="Tutup" class="p-1 rounded hover:bg-black/5" style="color:var(--ink-soft)">✕</button>
        </div>

        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded mb-4 rule-all" style="background:rgba(255,255,255,0.6)">
          <div>
            <p class="text-xs font-semibold" style="color:var(--ink)">Format Data Otomatis</p>
            <p class="text-[11px]" style="color:var(--ink-soft)">Kolom yang didukung: Nama barang, jenis/sifat, tanggal keluar/masuk, stok/jumlah, tanggal kadaluwarsa, dsb.</p>
          </div>
          <button id="btn-dl-template" class="text-xs font-medium px-3 py-1.5 rounded shadow-xs flex items-center justify-center gap-1.5 shrink-0" style="border:1px solid var(--rule);color:var(--ink);background:#fff">
            📥 Unduh Template Excel
          </button>
        </div>

        <div id="excel-drop-zone" class="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors mb-4" style="border-color:var(--rule);background:rgba(255,255,255,0.4)">
          <input type="file" id="excel-file-input" accept=".xlsx, .xls, .csv" class="hidden" />
          <svg class="mx-auto mb-2" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          <p class="text-sm font-semibold" style="color:var(--ink)">Pilih file Excel atau tarik file ke sini</p>
          <p id="excel-file-name" class="text-xs mt-1" style="color:var(--ink-soft)">Klik untuk memilih file spreadsheet</p>
        </div>

        <div id="excel-preview-container" class="hidden mb-4">
          <div class="flex items-center justify-between mb-2">
            <p class="serif font-bold text-sm" style="color:var(--ink)">Pratinjau Data (<span id="preview-count">0</span> barang)</p>
            <span id="preview-badge" class="text-xs font-medium px-2 py-0.5 rounded" style="background:rgba(46,125,50,0.1);color:var(--green)">Siap diimpor</span>
          </div>
          <div id="excel-preview-list" class="max-h-60 overflow-y-auto space-y-2 rule-all p-2.5 rounded bg-white/50 text-xs"></div>
        </div>

        <div class="flex justify-end gap-2 pt-3 rule-t">
          <button id="btn-cancel-import" class="text-sm font-medium px-4 py-2 rounded" style="background:#E5E7EB;color:var(--ink)">Batal</button>
          <button id="btn-confirm-import" disabled class="text-sm font-medium px-4 py-2 rounded shadow-sm opacity-50 cursor-not-allowed flex items-center gap-1.5" style="background:var(--blue);color:#fff">
            Proses & Simpan ke Database
          </button>
        </div>
      </div>
    </div>`;

  document.getElementById("close-modal").addEventListener("click", closeModal);
  document
    .getElementById("btn-cancel-import")
    .addEventListener("click", closeModal);
  document
    .getElementById("btn-dl-template")
    .addEventListener("click", () => downloadExcelTemplate());

  const dropZone = document.getElementById("excel-drop-zone");
  const fileInput = document.getElementById("excel-file-input");
  const fileNameEl = document.getElementById("excel-file-name");
  const previewContainer = document.getElementById("excel-preview-container");
  const previewList = document.getElementById("excel-preview-list");
  const previewCount = document.getElementById("preview-count");
  const confirmBtn = document.getElementById("btn-confirm-import");

  dropZone.addEventListener("click", () => fileInput.click());
  dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.style.borderColor = "var(--blue)";
  });
  dropZone.addEventListener("dragleave", () => {
    dropZone.style.borderColor = "var(--rule)";
  });
  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.style.borderColor = "var(--rule)";
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  });

  fileInput.addEventListener("change", (e) => {
    if (e.target.files && e.target.files[0]) {
      handleFile(e.target.files[0]);
    }
  });

  function handleFile(file) {
    fileNameEl.textContent = `File: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const { XLSX } = window;
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: "array", cellDates: false });

        const templateSheetName = workbook.SheetNames.find(
          (name) => name.trim().toLowerCase() === "template",
        );
        const sheetName = templateSheetName || workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const rawRows = XLSX.utils.sheet_to_json(worksheet, { defval: "" });

        if (rawRows.length === 0) {
          showToast("File Excel tidak memiliki data.");
          return;
        }

        parsedRows = rawRows
          .map((r) => {
            let name = "",
              group = defaultGroup,
              category = "",
              sifat = "",
              stock = 0,
              unit = "pcs";
            let type = "masuk",
              date = todayStr(),
              expiryDate = null,
              party = "",
              note = "",
              kondisi = "Baik";

            for (const [rawK, rawV] of Object.entries(r)) {
              const k = String(rawK || "")
                .trim()
                .toLowerCase()
                .replace(/[^a-z0-9]/g, "");
              const v = String(rawV ?? "").trim();
              if (!v && rawV === "") continue;

              if (
                (k.includes("nama") ||
                  k.includes("item") ||
                  k.includes("barang")) &&
                !k.includes("sifat") &&
                !k.includes("jenis")
              ) {
                name = v;
              } else if (
                k.includes("kelompok") ||
                k.includes("group") ||
                k.includes("segmen")
              ) {
                const lv = v.toLowerCase();
                if (lv.includes("sembako")) group = "sembako";
                else if (lv.includes("fasilitas") || lv.includes("aset"))
                  group = "fasilitas";
                else if (
                  lv.includes("sehat") ||
                  lv.includes("obat") ||
                  lv.includes("medis")
                )
                  group = "kesehatan";
              } else if (k.includes("kategori") || k.includes("category")) {
                category = v;
              } else if (
                k.includes("sifat") ||
                (k.includes("jenis") &&
                  (v.toLowerCase().includes("habis") ||
                    v.toLowerCase().includes("pakai")))
              ) {
                sifat = v.toLowerCase().includes("tidak")
                  ? "Tidak habis pakai"
                  : "Habis pakai";
              } else if (
                k.includes("tipe") ||
                (k.includes("jenis") &&
                  (v.toLowerCase() === "masuk" || v.toLowerCase() === "keluar"))
              ) {
                type = v.toLowerCase().includes("keluar") ? "keluar" : "masuk";
              } else if (
                k.includes("stok") ||
                k.includes("jumlah") ||
                k.includes("qty") ||
                k.includes("stock") ||
                k.includes("kuantitas") ||
                k.includes("volume")
              ) {
                stock = Number(String(rawV).replace(/[^0-9.-]/g, "")) || 0;
              } else if (k.includes("satuan") || k.includes("unit")) {
                unit = v.toLowerCase();
              } else if (
                k.includes("kadaluwarsa") ||
                k.includes("expired") ||
                k.includes("exp")
              ) {
                expiryDate = isDashInput(v) ? "-" : parseExcelDate(rawV);
              } else if (
                k.includes("tanggal") ||
                k.includes("tgl") ||
                k.includes("date")
              ) {
                date = isDashInput(v)
                  ? "-"
                  : parseExcelDate(rawV) || todayStr();
              } else if (
                k.includes("donatur") ||
                k.includes("penerima") ||
                k.includes("sumber") ||
                k.includes("tujuan") ||
                k.includes("pihak") ||
                k.includes("party")
              ) {
                party = v;
              } else if (
                k.includes("catatan") ||
                k.includes("note") ||
                k.includes("keterangan")
              ) {
                note = v;
              } else if (k.includes("kondisi")) {
                kondisi = v;
              }
            }

            if (!category) {
              if (group === "sembako") category = "Lain-lain";
              else if (group === "fasilitas") category = "Perabotan";
              else if (group === "kesehatan") category = "Obat-obatan";
            }

            if (!sifat) {
              sifat =
                group === "fasilitas" ? "Tidak habis pakai" : "Habis pakai";
            }

            return {
              name,
              group,
              category,
              sifat,
              stock,
              unit,
              type,
              date,
              expiryDate,
              party,
              note,
              kondisi,
            };
          })
          .filter((r) => r.name.length > 0);

        if (parsedRows.length === 0) {
          showToast("Tidak ditemukan baris barang yang valid pada file.");
          return;
        }

        previewContainer.classList.remove("hidden");
        previewCount.textContent = parsedRows.length;
        previewList.innerHTML = parsedRows
          .map((r, idx) => {
            const existing = items.find(
              (i) =>
                i.name.trim().toLowerCase() === r.name.trim().toLowerCase() &&
                i.group === r.group,
            );
            return `
            <div class="flex items-center justify-between p-2.5 rounded rule-b gap-2" style="background:#fff">
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-1.5 flex-wrap">
                  <span class="font-semibold text-xs" style="color:var(--ink)">${idx + 1}. ${esc(r.name)}</span>
                  <span class="text-[10px] px-1.5 py-0.2 rounded font-medium" style="background:rgba(0,0,0,0.05);color:var(--ink-soft)">${esc(r.sifat)}</span>
                  <span class="text-[10px] px-1.5 py-0.2 rounded font-medium" style="color:${getGroupColor(r.group)}">${getGroupLabel(r.group)} · ${esc(r.category)}</span>
                </div>
                <div class="text-[11px] flex items-center gap-2 flex-wrap mt-0.5" style="color:var(--ink-soft)">
                  <span>Tgl ${r.type === "keluar" ? "Keluar" : "Masuk"}: ${fmtDate(r.date)}</span>
                  ${r.expiryDate ? `<span>·</span><span class="mono text-red-600 font-medium">Exp: ${fmtDate(r.expiryDate)}</span>` : ""}
                  ${r.party ? `<span>·</span><span>${esc(r.party)}</span>` : ""}
                </div>
              </div>
              <div class="text-right shrink-0">
                <p class="mono font-bold text-xs" style="color:var(--ink)">${r.type === "keluar" ? "-" : "+"}${r.stock} ${esc(r.unit)}</p>
                <span class="text-[10px] font-semibold px-2 py-0.5 rounded" style="${existing ? "background:rgba(254,119,67,0.12);color:var(--gold)" : "background:rgba(46,125,50,0.12);color:var(--green)"}">${existing ? "Update Stok" : "Barang Baru"}</span>
              </div>
            </div>`;
          })
          .join("");

        confirmBtn.disabled = false;
        confirmBtn.classList.remove("opacity-50", "cursor-not-allowed");
      } catch (err) {
        showToast("Gagal membaca file Excel: " + err.message);
      }
    };
    reader.readAsArrayBuffer(file);
  }

  confirmBtn.addEventListener("click", async () => {
    if (parsedRows.length === 0) return;
    confirmBtn.disabled = true;
    confirmBtn.textContent = "Mengimpor data...";
    try {
      await executeExcelImport(parsedRows);
      closeModal();
    } catch (err) {
      showToast("Gagal menyimpan import: " + err.message);
      confirmBtn.disabled = false;
      confirmBtn.textContent = "Proses & Simpan ke Database";
    }
  });
}

function buildExcelRowSnapshot(row) {
  return {
    category: row.category || "",
    sifat: row.sifat || "",
    unit: row.unit || "",
    type: row.type || "masuk",
    stock: Number(row.stock) || 0,
    date: row.date || "",
    expiryDate: row.expiryDate || null,
    party: row.party || "",
    note: row.note || "",
    kondisi: row.kondisi || "",
  };
}

function snapshotsEqual(a, b) {
  if (!a || !b) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

function signedQty(snapshot) {
  return snapshot.type === "keluar" ? -snapshot.stock : snapshot.stock;
}

async function executeExcelImport(parsedRows) {
  let addedCount = 0;
  let updatedCount = 0;
  let unchangedCount = 0;

  for (const row of parsedRows) {
    const existing = items.find(
      (i) =>
        i.name.trim().toLowerCase() === row.name.trim().toLowerCase() &&
        i.group === row.group,
    );

    const newSnapshot = buildExcelRowSnapshot(row);

    if (existing) {
      const prevSnapshot = existing.lastExcelImport || null;

      if (snapshotsEqual(prevSnapshot, newSnapshot)) {
        unchangedCount++;
        continue;
      }

      const delta = prevSnapshot
        ? signedQty(newSnapshot) - signedQty(prevSnapshot)
        : signedQty(newSnapshot);

      const itemUpdates = {
        lastExcelImport: newSnapshot,
      };
      if (delta !== 0) itemUpdates.stock = increment(delta);
      if (row.expiryDate) itemUpdates.expiryDate = row.expiryDate;
      if (row.category) itemUpdates.category = row.category;
      if (row.sifat) itemUpdates.sifat = row.sifat;
      if (row.kondisi && row.group === "fasilitas")
        itemUpdates.kondisi = row.kondisi;

      await updateDoc(doc(db, "items", existing.id), itemUpdates);

      if (delta !== 0) {
        await addDoc(collection(db, "transactions"), {
          itemId: existing.id,
          group: row.group,
          type: delta < 0 ? "keluar" : "masuk",
          qty: Math.abs(delta),
          itemName: existing.name,
          unit: existing.unit || row.unit,
          category: existing.category || row.category,
          date: row.date || todayStr(),
          expiryDate: row.expiryDate || existing.expiryDate || null,
          party: row.party || "Import Excel",
          note: row.note || "Update via Import Excel",
          createdAt: serverTimestamp(),
        });
      }
      updatedCount++;
    } else {
      const qty = Number(row.stock) || 0;
      const delta = row.type === "keluar" ? -qty : qty;

      const newItemData = {
        name: row.name,
        group: row.group,
        category: row.category,
        unit: row.unit || "pcs",
        stock: Math.max(0, delta),
        sifat: row.sifat,
        expiryDate: row.expiryDate || null,
        kondisi: row.group === "fasilitas" ? row.kondisi || "Baik" : null,
        lastExcelImport: newSnapshot,
        createdAt: serverTimestamp(),
      };
      const newDoc = await addDoc(collection(db, "items"), newItemData);

      if (qty > 0) {
        await addDoc(collection(db, "transactions"), {
          itemId: newDoc.id,
          group: row.group,
          type: row.type || "masuk",
          qty,
          itemName: row.name,
          unit: row.unit || "pcs",
          category: row.category,
          date: row.date || todayStr(),
          expiryDate: row.expiryDate || null,
          party: row.party || "Import Excel",
          note: row.note || "Barang baru dari Import Excel",
          createdAt: serverTimestamp(),
        });
      }
      addedCount++;
    }
  }

  showToast(
    `Berhasil! ${addedCount} barang baru, ${updatedCount} barang diperbarui, ${unchangedCount} tidak ada perubahan.`,
  );
}

// ---------- Laporan ----------
function renderLaporan() {
  const d = new Date();
  d.setDate(1);
  const defaultStart = d.toISOString().slice(0, 10);
  contentEl.innerHTML = `
    <div class="mb-5">
      <h2 class="serif text-2xl font-bold" style="color:var(--ink)">Laporan</h2>
      <p class="text-sm mt-0.5" style="color:var(--ink-soft)">Rekap donasi & distribusi berdasarkan rentang tanggal</p>
    </div>
    <div class="rounded-md p-4 mb-6 rule-all" style="background:rgba(255,255,255,0.5)">
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-3 items-end">
        <label class="block"><span class="text-xs font-medium mb-1 block" style="color:var(--ink-soft)">Dari tanggal</span>
          <input type="date" id="lap-start" value="${defaultStart}" class="w-full border rounded px-3 py-2 text-sm bg-white/70 h-[38px]" /></label>
        <label class="block"><span class="text-xs font-medium mb-1 block" style="color:var(--ink-soft)">Sampai tanggal</span>
          <input type="date" id="lap-end" value="${todayStr()}" class="w-full border rounded px-3 py-2 text-sm bg-white/70 h-[38px]" /></label>
        <label class="block"><span class="text-xs font-medium mb-1 block" style="color:var(--ink-soft)">Kelompok</span>
          <select id="lap-group" class="w-full border rounded px-3 py-2 text-sm bg-white/70 h-[38px]">
            <option value="semua">Semua</option>
            <option value="sembako">Sembako</option>
            <option value="fasilitas">Fasilitas</option>
            <option value="kesehatan">Kesehatan</option>
          </select></label>
        <div>
          <button id="lap-export" class="w-full text-sm font-medium px-3.5 py-2 rounded shadow-sm flex items-center justify-center gap-1.5 h-[38px]" style="background:var(--ink);color:#fff">⬇ Unduh PDF</button>
        </div>
      </div>
      <div class="flex flex-wrap gap-2">
        <button data-preset="hari" class="lap-preset text-xs px-3 py-1 rounded bg-white/50" style="color:var(--ink-soft);border:1px solid var(--rule)">Hari ini</button>
        <button data-preset="minggu" class="lap-preset text-xs px-3 py-1 rounded bg-white/50" style="color:var(--ink-soft);border:1px solid var(--rule)">7 hari</button>
        <button data-preset="bulan" class="lap-preset text-xs px-3 py-1 rounded bg-white/50" style="color:var(--ink-soft);border:1px solid var(--rule)">30 hari</button>
      </div>
    </div>
    <p class="serif font-bold mb-3" style="color:var(--ink)">Ringkasan per kategori</p>
    <div id="lap-summary" class="grid sm:grid-cols-2 gap-2 mb-6"></div>
    <p class="serif font-bold mb-3" style="color:var(--ink)">Detail transaksi</p>
    <div id="lap-detail" class="space-y-2"></div>
  `;

  function paint() {
    const start = document.getElementById("lap-start").value;
    const end = document.getElementById("lap-end").value;
    const group = document.getElementById("lap-group").value;
    const filtered = transactions.filter(
      (t) =>
        t.date >= start &&
        t.date <= end &&
        (group === "semua" || t.group === group),
    );

    const summary = {};
    filtered.forEach((t) => {
      const key = `${t.group}__${t.category}`;
      if (!summary[key])
        summary[key] = {
          category: t.category,
          masuk: 0,
          keluar: 0,
          unit: t.unit,
          group: t.group,
        };
      summary[key][t.type] += t.qty;
    });

    // Stok akhir adalah stok terkini di Firestore setelah seluruh transaksi masuk/keluar.
    Object.values(summary).forEach((s) => {
      s.stokAkhir = items
        .filter((i) => i.group === s.group && i.category === s.category)
        .reduce((total, i) => total + (Number(i.stock) || 0), 0);
    });

    document.getElementById("lap-summary").innerHTML =
      Object.keys(summary).length === 0
        ? `<p class="text-sm col-span-2" style="color:var(--ink-soft)">Tidak ada transaksi pada rentang ini.</p>`
        : Object.values(summary)
            .map(
              (s) => `
        <div class="rounded p-3 text-sm flex items-center justify-between rule-all" style="background:rgba(255,255,255,0.5)">
          <span style="color:${getGroupColor(s.group)}">${esc(s.category)}</span>
          <span class="mono"><span style="color:var(--green)">+${s.masuk}</span> / <span style="color:var(--red)">-${s.keluar}</span> · Stok: ${s.stokAkhir} ${esc(s.unit)}</span>
        </div>`,
            )
            .join("");

    document.getElementById("lap-detail").innerHTML =
      filtered.length === 0
        ? `<p class="text-sm" style="color:var(--ink-soft)">Tidak ada data untuk ditampilkan.</p>`
        : filtered
            .map(
              (t) => `
        <div class="flex items-center justify-between gap-3 text-sm py-2 rule-b">
          <div class="flex items-center gap-2 sm:gap-3 flex-wrap min-w-0 flex-1">
            ${stampHtml(t.type)}
            <span class="text-xs font-medium" style="color:${getGroupColor(t.group)}">${esc(t.category)}</span>
            <span class="font-medium" style="color:var(--ink)">${esc(t.itemName)}</span>
            <span class="mono text-xs sm:text-sm" style="color:var(--ink-soft)">${t.qty} ${esc(t.unit)}</span>
            ${t.party ? `<span class="text-xs" style="color:var(--ink-soft)">— ${esc(t.party)}</span>` : ""}
            ${t.expiryDate ? `<span class="mono text-[11px] px-1.5 py-0.5 rounded" style="background:rgba(0,0,0,0.04);color:var(--ink-soft)">Exp: ${fmtDate(t.expiryDate)}</span>` : ""}
          </div>
          <span class="mono text-xs shrink-0" style="color:var(--ink-soft)">${fmtDate(t.date)}</span>
        </div>`,
            )
            .join("");

    document.getElementById("lap-export").onclick = async () => {
      const btn = document.getElementById("lap-export");
      const original = btn.textContent;
      btn.textContent = "Menyiapkan PDF...";
      btn.disabled = true;
      try {
        await loadScriptOnce(
          "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js",
        );
        await loadScriptOnce(
          "https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js",
        );

        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF({
          orientation: "landscape",
          unit: "mm",
          format: "a4",
        });
        const groupLabel = getGroupLabel(group);

        const GREEN = [46, 125, 50];
        const RED = [197, 48, 48];
        const ORANGE = [221, 92, 41];
        const PURPLE = [124, 58, 237];
        const BLUE = [37, 99, 235];
        const DARKHEAD = [39, 63, 79];

        function getPdfGroupColor(grp) {
          if (grp === "sembako") return ORANGE;
          if (grp === "fasilitas") return PURPLE;
          if (grp === "kesehatan") return BLUE;
          return DARKHEAD;
        }

        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(14);
        pdf.text("Laporan Buku Logistik Panti", 14, 15);
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(10);
        pdf.text(`Periode: ${fmtDate(start)} - ${fmtDate(end)}`, 14, 21);
        pdf.text(`Kelompok: ${groupLabel}`, 14, 26);

        const summaryEntries = Object.values(summary);

        pdf.autoTable({
          startY: 32,
          head: [["Kategori", "Masuk", "Keluar", "Stok Akhir", "Satuan"]],
          body: summaryEntries.map((s) => [
            s.category,
            `+${s.masuk}`,
            `-${s.keluar}`,
            s.stokAkhir,
            s.unit,
          ]),
          theme: "grid",
          headStyles: { fillColor: DARKHEAD },
          styles: { fontSize: 9 },
          margin: { left: 14, right: 14 },
          didParseCell: (data) => {
            if (data.section !== "body") return;
            const rowGroup = summaryEntries[data.row.index].group;
            if (data.column.index === 0)
              data.cell.styles.textColor = getPdfGroupColor(rowGroup);
            if (data.column.index === 1) data.cell.styles.textColor = GREEN;
            if (data.column.index === 2) data.cell.styles.textColor = RED;
          },
        });

        const detailY = (pdf.lastAutoTable?.finalY || 32) + 10;
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(11);
        pdf.text("Detail Transaksi", 14, detailY - 4);

        pdf.autoTable({
          startY: detailY,
          head: [
            [
              "Tanggal",
              "Kelompok",
              "Kategori",
              "Barang",
              "Jenis",
              "Jumlah",
              "Satuan",
              "Sumber/Tujuan",
              "Catatan",
            ],
          ],
          body: filtered.map((t) => [
            fmtDate(t.date),
            t.group,
            t.category,
            t.itemName,
            t.type === "masuk" ? "Masuk" : "Keluar",
            t.qty,
            t.unit,
            t.party || "-",
            t.note || "-",
          ]),
          theme: "grid",
          headStyles: { fillColor: DARKHEAD },
          styles: { fontSize: 8 },
          margin: { left: 14, right: 14 },
          didParseCell: (data) => {
            if (data.section !== "body") return;
            const rowTx = filtered[data.row.index];
            if (data.column.index === 1 || data.column.index === 2) {
              data.cell.styles.textColor = getPdfGroupColor(rowTx.group);
            }
            if (data.column.index === 4) {
              data.cell.styles.textColor = rowTx.type === "masuk" ? GREEN : RED;
            }
          },
        });

        pdf.save(`laporan-${start}_${end}.pdf`);
      } catch (e) {
        showToast("Gagal membuat PDF: " + e.message);
      } finally {
        btn.textContent = original;
        btn.disabled = false;
      }
    };
  }

  document.getElementById("lap-start").addEventListener("change", paint);
  document.getElementById("lap-end").addEventListener("change", paint);
  document.getElementById("lap-group").addEventListener("change", paint);
  document.querySelectorAll(".lap-preset").forEach((btn) =>
    btn.addEventListener("click", () => {
      const today = new Date();
      if (btn.dataset.preset === "hari") {
        document.getElementById("lap-start").value = todayStr();
        document.getElementById("lap-end").value = todayStr();
      }
      if (btn.dataset.preset === "minggu") {
        const dd = new Date(today);
        dd.setDate(dd.getDate() - 6);
        document.getElementById("lap-start").value = dd
          .toISOString()
          .slice(0, 10);
        document.getElementById("lap-end").value = todayStr();
      }
      if (btn.dataset.preset === "bulan") {
        const dd = new Date(today.getFullYear(), today.getMonth(), 1);
        document.getElementById("lap-start").value = dd
          .toISOString()
          .slice(0, 10);
        document.getElementById("lap-end").value = todayStr();
      }
      paint();
    }),
  );
  paint();
}

render();
