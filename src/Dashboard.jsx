import { useState, useMemo, useEffect } from "react";
import { SALES_SHEETS, parseProjectCsv, deduplicateProjects, signedDay, contractCents, paidSalesMetrics } from "./paidSales.js";
import { applyCommunications, fetchCommunications } from "./communications.js";
import { applyEmailCounts, displayEmailCount, fetchEmailCounts, EMAIL_TIME_ZONE, localDay } from "./emailCounts.js";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LineChart, Line, ComposedChart, Area, AreaChart, PieChart, Pie, Cell, Legend
} from "recharts";
import {
  TrendingUp, TrendingDown, DollarSign, FileText, Calendar, Users,
  Clock, CreditCard, MapPin, BarChart3, Activity, ClipboardList, Send, Wallet, Mail, PhoneIncoming, PhoneCall, PhoneMissed, Voicemail
} from "lucide-react";

const LOGO_URL = "https://theeventrentalguys.com/wp-content/uploads/2026/05/allwhite_transparent_HiRes.webp";

const COLORS = {
  primary: "#1B1A32",
  accent: "#7674B6",
  accentDark: "#5C5A9E",
  accentLight: "#E8E7F5",
  green: "#16a34a",
  greenLight: "#dcfce7",
  red: "#dc2626",
  redLight: "#fee2e2",
  blue: "#2563eb",
  blueLight: "#dbeafe",
  purple: "#7674B6",
  purpleLight: "#E8E7F5",
  orange: "#ea580c",
  orangeLight: "#ffedd5",
  cyan: "#06b6d4",
  pink: "#ec4899",
  slate: "#64748b",
  bg: "#F8F9FC",
  cardBg: "#FFFFFF",
  cardBorder: "#E2E8F0",
  text: "#1E293B",
  textMuted: "#64748b",
  headerBg: "#1B1A32",
};

const CHART_COLORS = ["#7674B6", "#9997D0", "#16a34a", "#06b6d4", "#ec4899", "#ea580c", "#5C5A9E", "#64748b", "#dc2626", "#a3e635"];

// ── Live Data Fetching from Google Sheets ──
const GSP_SHEET_ID = "1FBUAn82wrX2fIjgRwWDqk1C8VES6dV_yhhuVQ9TihDI";

function parseCSVLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      result.push(current); current = "";
    } else { current += ch; }
  }
  result.push(current);
  return result;
}

function parseCSV(text) {
  const lines = text.split("\n");
  const headers = parseCSVLine(lines[0]);
  return lines.slice(1).filter(l => l.trim()).map(line => {
    const values = parseCSVLine(line);
    const row = {};
    headers.forEach((h, i) => (row[h.trim()] = (values[i] || "").trim()));
    return row;
  });
}

function parseMoney(str) {
  if (!str) return 0;
  return parseFloat(str.replace(/[$,]/g, "")) || 0;
}

function parseGSPDate(str) {
  if (!str) return null;
  const [m, d, y] = str.split("/");
  if (!m || !d || !y) return null;
  return new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
}

function sameDay(d1, d2) {
  return d1 && d2 && d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() && d1.getDate() === d2.getDate();
}

function getMonday(date) {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  d.setHours(0, 0, 0, 0);
  return d;
}

// Accepts "MM/DD/YYYY ...", "YYYY-MM-DD ..." or anything Date can parse
function parseLooseDate(str) {
  if (!str) return null;
  let m = str.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return new Date(parseInt(m[3]), parseInt(m[1]) - 1, parseInt(m[2]));
  m = str.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]));
  const t = Date.parse(str);
  if (isNaN(t)) return null;
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

// Goodshuffle puts the export timestamp in the first header cell:
// "Goodshuffle Pro Project List Export 08/14/2026 @ 3:27 PM EDT Project ID"
function parseExportDate(rows) {
  const firstHeader = rows.length ? Object.keys(rows[0])[0] : "";
  const m = firstHeader.match(/Export (\d{1,2}\/\d{1,2}\/\d{4})(?: @ (\d{1,2}:\d{2} [AP]M))?/);
  if (!m) return null;
  return { date: parseGSPDate(m[1]), time: m[2] || null };
}

// Month label "Mar 26" → sortable month index
const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const monthIndex = (label) => {
  const [mon, yy] = label.split(" ");
  return (2000 + parseInt(yy)) * 12 + MONTH_NAMES.indexOf(mon);
};


async function fetchLiveGSPData() {
  try {
    const url = `https://docs.google.com/spreadsheets/d/${GSP_SHEET_ID}/gviz/tq?tqx=out:csv`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error("GSP fetch failed");
    const csv = await resp.text();
    const exportInfo = parseExportDate(parseCSV(csv));
    const rows = parseProjectCsv(csv);
    const historical = await Promise.all(SALES_SHEETS.slice(1).map(async sheet => {
      const historyResponse = await fetch(`https://docs.google.com/spreadsheets/d/${GSP_SHEET_ID}/gviz/tq?tqx=out:csv&gid=${sheet.gid}`);
      if (!historyResponse.ok) throw new Error(`Cannot read ${sheet.name} sales history`);
      return parseProjectCsv(await historyResponse.text());
    }));
    const allRows = deduplicateProjects([rows, ...historical]);

    const now = new Date();
    const todayKey = localDay(now);
    const today = new Date(`${todayKey}T00:00:00`);
    const paidMetrics = paidSalesMetrics(allRows, todayKey);
    const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
    const monday = getMonday(today);
    const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
    const lastMonday = new Date(monday); lastMonday.setDate(monday.getDate() - 7);
    const lastSunday = new Date(monday.getTime() - 1);
    const currentYear = today.getFullYear();
    const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

    // ── Helper: count metrics for a single day ──
    const dayMetrics = (targetDate) => ({
      wishlists: 0,
      forms: 0, // Overlaid from verified email received dates, independently of sales.
      quotesCreated: rows.filter(r => sameDay(parseGSPDate(r["Date Created"]), targetDate)).length,
      quotesSent: rows.filter(r => sameDay(parseGSPDate(r["Last Quote Sent"]), targetDate)).length,
      contracts: allRows.filter(r => r["Status"] === "Contract Signed" && sameDay(parseGSPDate(r["First Signed Date"]), targetDate)).length,
      totalSales: paidMetrics.eligibleRows.filter(r => sameDay(parseGSPDate(r["First Signed Date"]), targetDate))
        .reduce((sum, r) => sum + contractCents(r), 0) / 100,
    });

    // ── Week breakdown by day ──
    const buildWeek = (weekStart) => {
      const days = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date(weekStart); d.setDate(weekStart.getDate() + i);
        const m = dayMetrics(d);
        days.push({ day: dayNames[i], ...m, sales: m.totalSales });
      }
      return days;
    };

    const weekDays = buildWeek(monday);
    const lastWeekDays = buildWeek(lastMonday);
    const sumWeek = (arr) => arr.reduce((a, d) => ({
      wishlists: a.wishlists + d.wishlists, forms: a.forms + d.forms,
      quotesCreated: a.quotesCreated + d.quotesCreated, quotesSent: a.quotesSent + d.quotesSent,
      contracts: a.contracts + d.contracts, sales: a.sales + d.sales,
    }), { wishlists: 0, forms: 0, quotesCreated: 0, quotesSent: 0, contracts: 0, sales: 0 });

    // ── Year-to-date (current year, contract signed only for revenue) ──
    const yearRows = rows.filter(r => { const d = parseGSPDate(r["Date Created"]); return d && d.getFullYear() === currentYear; });
    const signedYear = paidMetrics.rows;

    // Top 5 clients by spend
    const clientMap = {};
    signedYear.forEach(r => {
      const n = r["Client Name"];
      const amt = contractCents(r) / 100;
      if (!clientMap[n]) clientMap[n] = { name: n, spend: 0, orders: 0 };
      clientMap[n].spend += amt; clientMap[n].orders += 1;
    });
    const top5 = Object.values(clientMap)
      .map(c => ({ ...c, spend: Math.round(c.spend), aov: c.orders ? Math.round(c.spend / c.orders) : 0 }))
      .sort((a, b) => b.spend - a.spend).slice(0, 5);

    // Earned vs Unearned
    const earnedRows = signedYear.filter(r => { const d = parseGSPDate(r["Logistics Start Date"]); return d && d <= today; });
    const unearnedRows = signedYear.filter(r => { const d = parseGSPDate(r["Logistics Start Date"]); return !d || d > today; });
    const sumTotal = (arr) => arr.reduce((sum, r) => sum + contractCents(r), 0) / 100;

    const totalSigned = sumTotal(signedYear);

    // One paid, first-signing-date model supplies both tabs and every monthly chart.
    const liveMonthly = paidMetrics.monthly;

    return {
      todayData: dayMetrics(today),
      yesterdayData: dayMetrics(yesterday),
      weekData: weekDays,
      weekTotals: sumWeek(weekDays),
      lastWeekTotals: sumWeek(lastWeekDays),
      topClients2026: top5,
      earnedRevenue2026: {
        earned: Math.round(sumTotal(earnedRows)), earnedCount: earnedRows.length,
        unearned: Math.round(sumTotal(unearnedRows)), unearnedCount: unearnedRows.length,
      },
      totalSales2026: totalSigned,
      paidContractCount: paidMetrics.count,
      totalPipeline2026: Math.round(yearRows.reduce((s, r) => s + parseMoney(r["Quote Total"]), 0)),
      gspStatusCounts: {
        contractSigned: yearRows.filter(r => r["Status"] === "Contract Signed").length,
        quoteSent: yearRows.filter(r => r["Status"] === "Quote Sent").length,
        newProject: yearRows.filter(r => r["Status"] === "New Project").length,
      },
      liveMonthly,
      exportInfo,
    };
  } catch (err) {
    console.error("Live data fetch failed, using defaults:", err);
    return null;
  }
}

// ── Default / Fallback Data (used before live data loads) ──
// ── Today's Data (May 10 — no GSP activity yet today) ──
// Sources: Wishlists = placeholder, Forms = WPForms sheet (currently empty),
// Quotes/Contracts/Sales = Master GSP Data "Date Created" column
const todayData = {
  wishlists: 0,    // Placeholder — no source connected yet
  forms: 0,        // WPForms Spreadsheet — currently empty
  quotesCreated: 0, // GSP: rows with Date Created = 05/10/2026
  quotesSent: 0,   // GSP: rows with Last Quote Sent = 05/10/2026
  contracts: 0,    // GSP: Contract Signed with Date Created = today
  totalSales: 0,   // GSP: Quote Total for today's Contract Signed
};

// ── Yesterday's Data (May 9 — from GSP) ──
const yesterdayData = {
  wishlists: 0,
  forms: 0,
  quotesCreated: 1,  // GSP: 1 quote created on 05/09
  quotesSent: 0,
  contracts: 0,
  totalSales: 0,
};

// ── This week's data (Mon May 5 – Sun May 11, from GSP) ──
// Quotes Created per day from GSP Date Created column (54 total this week)
// Contracts Signed breakdown estimated from GSP data
const weekData = [
  { day: "Mon", wishlists: 0, forms: 0, quotesCreated: 16, quotesSent: 0, contracts: 5, sales: 2841 },
  { day: "Tue", wishlists: 0, forms: 0, quotesCreated: 9,  quotesSent: 0, contracts: 4, sales: 3122 },
  { day: "Wed", wishlists: 0, forms: 0, quotesCreated: 18, quotesSent: 0, contracts: 7, sales: 4053 },
  { day: "Thu", wishlists: 0, forms: 0, quotesCreated: 10, quotesSent: 0, contracts: 4, sales: 2748 },
  { day: "Fri", wishlists: 0, forms: 0, quotesCreated: 1,  quotesSent: 0, contracts: 2, sales: 1081 },
  { day: "Sat", wishlists: 0, forms: 0, quotesCreated: 0,  quotesSent: 0, contracts: 0, sales: 0 },
  { day: "Sun", wishlists: 0, forms: 0, quotesCreated: 0,  quotesSent: 0, contracts: 0, sales: 0 },
];

const weekTotals = weekData.reduce(
  (acc, d) => ({
    wishlists: acc.wishlists + d.wishlists,
    forms: acc.forms + d.forms,
    quotesCreated: acc.quotesCreated + d.quotesCreated,
    quotesSent: acc.quotesSent + d.quotesSent,
    contracts: acc.contracts + d.contracts,
    sales: acc.sales + d.sales,
  }),
  { wishlists: 0, forms: 0, quotesCreated: 0, quotesSent: 0, contracts: 0, sales: 0 }
);

// ── Last week's totals (no prior week data in current export) ──
const lastWeekTotals = {
  wishlists: 0,
  forms: 0,
  quotesCreated: 0,
  quotesSent: 0,
  contracts: 0,
  sales: 0,
};

// ── Historical Data ──


const countyData = [
  { county: "Bergen", revenue: 544788, count: 840 },
  { county: "Essex", revenue: 195819, count: 221 },
  { county: "Hudson", revenue: 192380, count: 161 },
  { county: "Other", revenue: 178849, count: 424 },
  { county: "Rockland", revenue: 82657, count: 54 },
  { county: "Passaic", revenue: 39711, count: 52 },
  { county: "Union", revenue: 36631, count: 37 },
  { county: "Morris", revenue: 35203, count: 31 },
  { county: "Monmouth", revenue: 29078, count: 14 },
  { county: "Middlesex", revenue: 23647, count: 21 },
];

const cityData = [
  { city: "Jersey City", revenue: 144151, count: 75, aov: 1922 },
  { city: "Newark", revenue: 68710, count: 38, aov: 1808 },
  { city: "Englewood", revenue: 42959, count: 43, aov: 999 },
  { city: "Franklin Lakes", revenue: 42402, count: 21, aov: 2019 },
  { city: "Upper Saddle River", revenue: 29520, count: 14, aov: 2109 },
  { city: "Montclair", revenue: 28889, count: 37, aov: 781 },
  { city: "Mahwah", revenue: 23740, count: 19, aov: 1249 },
  { city: "Paramus", revenue: 23206, count: 54, aov: 430 },
  { city: "Hackensack", revenue: 23093, count: 41, aov: 563 },
  { city: "Teaneck", revenue: 22688, count: 59, aov: 385 },
  { city: "Monroe", revenue: 19689, count: 13, aov: 1515 },
  { city: "Waldwick", revenue: 19688, count: 12, aov: 1641 },
  { city: "East Rutherford", revenue: 19099, count: 5, aov: 3820 },
  { city: "New York", revenue: 17854, count: 10, aov: 1785 },
  { city: "Nanuet", revenue: 17655, count: 6, aov: 2943 },
];

const salesData = [
  { lead: "Leonel Fuentes", revenue: 1393784, count: 1779, aov: 783 },
  { lead: "Erilai Aguilar", revenue: 42748, count: 100, aov: 427 },
  { lead: "Grovert Fuentes", revenue: 34675, count: 21, aov: 1651 },
  { lead: "Marvin Fuentes", revenue: 4622, count: 12, aov: 385 },
  { lead: "Alejandro Leon", revenue: 3469, count: 5, aov: 694 },
  { lead: "Tyler Danser", revenue: 3053, count: 7, aov: 436 },
];

const seasonalityData = [
  { month: "Jan", avgRev: 1263, total: 103565, count: 82 },
  { month: "Feb", avgRev: 1101, total: 114475, count: 104 },
  { month: "Mar", avgRev: 1068, total: 181637, count: 170 },
  { month: "Apr", avgRev: 785, total: 123974, count: 158 },
  { month: "May", avgRev: 637, total: 148504, count: 233 },
  { month: "Jun", avgRev: 764, total: 131399, count: 172 },
  { month: "Jul", avgRev: 631, total: 131907, count: 209 },
  { month: "Aug", avgRev: 797, total: 145143, count: 182 },
  { month: "Sep", avgRev: 794, total: 134216, count: 169 },
  { month: "Oct", avgRev: 792, total: 106079, count: 134 },
  { month: "Nov", avgRev: 515, total: 89557, count: 174 },
  { month: "Dec", avgRev: 525, total: 71894, count: 137 },
];

const breakdownData = [
  { name: "Rentals", value: 896458 },
  { name: "Logistics", value: 330405 },
  { name: "Services", value: 101603 },
  { name: "Tax", value: 82318 },
];

const billingData = [
  { status: "Paid", revenue: 1264479, count: 1811 },
  { status: "Due", revenue: 60122, count: 23 },
  { status: "Overpaid", revenue: 31698, count: 29 },
];

// ── 2026 GSP Data (from Master GSP Sheet — Contract Signed only) ──
// Top 5 clients filtered to Status = "Contract Signed" (actual customers)
const topClients2026 = [
  { name: "Daniel Ledwith", spend: 3178, orders: 1, aov: 3178 },
  { name: "Danielle Zabala", spend: 1828, orders: 1, aov: 1828 },
  { name: "Tiana Green", spend: 1651, orders: 1, aov: 1651 },
  { name: "Jeremy Patuto", spend: 1082, orders: 1, aov: 1082 },
  { name: "Kerry Hayes", spend: 721, orders: 1, aov: 721 },
];

// Earned = logistics start date has passed; Unearned = upcoming or no date
const earnedRevenue2026 = { earned: 748, earnedCount: 2, unearned: 13097, unearnedCount: 20 };
// Total sales = sum of Quote Total for all Contract Signed rows
const totalSales2026 = 13845; // 22 contracts signed
// Total pipeline = all projects regardless of status (64 projects in current export)
const totalPipeline2026 = 13845;
// Status breakdown
const gspStatusCounts = { contractSigned: 22, quoteSent: 35, newProject: 7 };

// ── Marketing Raw Daily Data (Windsor.ai — Apr 9 – May 9, 2026) ──
const GA4_DAILY = [
  { d:"2026-04-09", s:223, pv:860, u:126, nu:228, br:56.0, dur:183 },
  { d:"2026-04-10", s:178, pv:470, u:98, nu:173, br:62.4, dur:126 },
  { d:"2026-04-11", s:199, pv:826, u:118, nu:227, br:52.8, dur:279 },
  { d:"2026-04-12", s:275, pv:1146, u:167, nu:311, br:58.9, dur:250 },
  { d:"2026-04-13", s:261, pv:1006, u:147, nu:270, br:57.5, dur:230 },
  { d:"2026-04-14", s:280, pv:1048, u:160, nu:269, br:55.7, dur:287 },
  { d:"2026-04-15", s:238, pv:659, u:140, nu:254, br:54.2, dur:167 },
  { d:"2026-04-16", s:260, pv:905, u:147, nu:261, br:49.2, dur:285 },
  { d:"2026-04-17", s:211, pv:617, u:116, nu:202, br:58.8, dur:199 },
  { d:"2026-04-18", s:347, pv:753, u:192, nu:371, br:74.4, dur:123 },
  { d:"2026-04-19", s:223, pv:798, u:141, nu:255, br:60.5, dur:236 },
  { d:"2026-04-20", s:262, pv:1108, u:157, nu:279, br:37.4, dur:288 },
  { d:"2026-04-21", s:240, pv:1029, u:143, nu:263, br:38.3, dur:245 },
  { d:"2026-04-22", s:247, pv:1005, u:147, nu:259, br:45.3, dur:269 },
  { d:"2026-04-23", s:227, pv:694, u:132, nu:234, br:50.7, dur:286 },
  { d:"2026-04-24", s:196, pv:591, u:109, nu:181, br:50.0, dur:162 },
  { d:"2026-04-25", s:167, pv:704, u:100, nu:184, br:50.3, dur:306 },
  { d:"2026-04-26", s:201, pv:992, u:134, nu:238, br:47.8, dur:338 },
  { d:"2026-04-27", s:258, pv:981, u:154, nu:268, br:50.8, dur:247 },
  { d:"2026-04-28", s:197, pv:1010, u:116, nu:199, br:38.1, dur:368 },
  { d:"2026-04-29", s:186, pv:731, u:113, nu:194, br:32.8, dur:294 },
  { d:"2026-04-30", s:176, pv:756, u:111, nu:189, br:41.5, dur:244 },
  { d:"2026-05-01", s:179, pv:652, u:110, nu:190, br:43.6, dur:295 },
  { d:"2026-05-02", s:132, pv:457, u:81, nu:148, br:44.7, dur:295 },
  { d:"2026-05-03", s:141, pv:858, u:99, nu:173, br:33.3, dur:419 },
  { d:"2026-05-04", s:175, pv:539, u:134, nu:112, br:39.4, dur:228 },
  { d:"2026-05-05", s:215, pv:598, u:160, nu:139, br:35.4, dur:247 },
  { d:"2026-05-06", s:222, pv:576, u:179, nu:154, br:32.9, dur:227 },
  { d:"2026-05-07", s:200, pv:461, u:145, nu:131, br:40.0, dur:168 },
  { d:"2026-05-08", s:187, pv:474, u:148, nu:127, br:41.7, dur:160 },
  { d:"2026-05-09", s:54, pv:135, u:51, nu:43, br:98.2, dur:483 },
];

const ADS_DAILY = [
  { d:"2026-04-09", sp:48.34, cl:51, im:496, cv:0 },
  { d:"2026-04-10", sp:34.80, cl:31, im:385, cv:0 },
  { d:"2026-04-11", sp:44.69, cl:43, im:504, cv:0 },
  { d:"2026-04-12", sp:65.45, cl:66, im:544, cv:0 },
  { d:"2026-04-13", sp:53.09, cl:47, im:600, cv:0 },
  { d:"2026-04-14", sp:64.52, cl:63, im:599, cv:2 },
  { d:"2026-04-15", sp:69.61, cl:53, im:577, cv:1 },
  { d:"2026-04-16", sp:66.89, cl:58, im:472, cv:0 },
  { d:"2026-04-17", sp:34.89, cl:35, im:530, cv:0 },
  { d:"2026-04-18", sp:37.67, cl:46, im:413, cv:0 },
  { d:"2026-04-19", sp:37.73, cl:45, im:518, cv:0 },
  { d:"2026-04-20", sp:75.24, cl:75, im:854, cv:3 },
  { d:"2026-04-21", sp:75.74, cl:58, im:676, cv:2 },
  { d:"2026-04-22", sp:51.13, cl:39, im:506, cv:0 },
  { d:"2026-04-23", sp:64.26, cl:49, im:536, cv:4 },
  { d:"2026-04-24", sp:46.75, cl:45, im:641, cv:1 },
  { d:"2026-04-25", sp:58.09, cl:55, im:568, cv:0 },
  { d:"2026-04-26", sp:46.61, cl:55, im:502, cv:0 },
  { d:"2026-04-27", sp:64.68, cl:55, im:652, cv:1 },
  { d:"2026-04-28", sp:45.79, cl:47, im:602, cv:1 },
  { d:"2026-04-29", sp:59.72, cl:55, im:591, cv:1 },
  { d:"2026-04-30", sp:39.34, cl:42, im:525, cv:1 },
  { d:"2026-05-01", sp:68.19, cl:57, im:602, cv:2 },
  { d:"2026-05-02", sp:34.88, cl:41, im:497, cv:2 },
  { d:"2026-05-03", sp:65.60, cl:63, im:509, cv:1 },
  { d:"2026-05-04", sp:94.65, cl:80, im:735, cv:7 },
  { d:"2026-05-05", sp:114.47, cl:96, im:978, cv:2 },
  { d:"2026-05-06", sp:155.87, cl:110, im:1182, cv:1 },
  { d:"2026-05-07", sp:143.96, cl:107, im:1272, cv:2 },
  { d:"2026-05-08", sp:135.98, cl:99, im:996, cv:1 },
  { d:"2026-05-09", sp:68.58, cl:46, im:500, cv:0 },
];

const SC_DAILY = [
  { d:"2026-04-09", cl:28, im:1157, ctr:2.42, pos:20.6 },
  { d:"2026-04-10", cl:15, im:1068, ctr:1.40, pos:22.2 },
  { d:"2026-04-11", cl:11, im:966, ctr:1.14, pos:21.4 },
  { d:"2026-04-12", cl:8, im:1212, ctr:0.66, pos:20.2 },
  { d:"2026-04-13", cl:28, im:1535, ctr:1.82, pos:17.8 },
  { d:"2026-04-14", cl:19, im:1362, ctr:1.40, pos:19.6 },
  { d:"2026-04-15", cl:15, im:1462, ctr:1.03, pos:18.7 },
  { d:"2026-04-16", cl:19, im:1634, ctr:1.16, pos:18.9 },
  { d:"2026-04-17", cl:14, im:1563, ctr:0.90, pos:19.8 },
  { d:"2026-04-18", cl:13, im:1440, ctr:0.90, pos:20.7 },
  { d:"2026-04-19", cl:12, im:1867, ctr:0.64, pos:18.5 },
  { d:"2026-04-20", cl:29, im:1869, ctr:1.55, pos:17.3 },
  { d:"2026-04-21", cl:27, im:2289, ctr:1.18, pos:17.9 },
  { d:"2026-04-22", cl:24, im:1371, ctr:1.75, pos:16.3 },
  { d:"2026-04-23", cl:23, im:1345, ctr:1.71, pos:15.4 },
  { d:"2026-04-24", cl:15, im:1146, ctr:1.31, pos:14.4 },
  { d:"2026-04-25", cl:21, im:1377, ctr:1.53, pos:14.4 },
  { d:"2026-04-26", cl:27, im:1487, ctr:1.82, pos:16.3 },
  { d:"2026-04-27", cl:30, im:1659, ctr:1.81, pos:14.6 },
  { d:"2026-04-28", cl:29, im:1354, ctr:2.14, pos:15.9 },
  { d:"2026-04-29", cl:25, im:1516, ctr:1.65, pos:16.4 },
  { d:"2026-04-30", cl:16, im:1440, ctr:1.11, pos:16.4 },
  { d:"2026-05-01", cl:16, im:1415, ctr:1.13, pos:14.4 },
  { d:"2026-05-02", cl:20, im:1420, ctr:1.41, pos:15.0 },
  { d:"2026-05-03", cl:26, im:1848, ctr:1.41, pos:15.1 },
  { d:"2026-05-04", cl:24, im:1920, ctr:1.25, pos:13.5 },
  { d:"2026-05-05", cl:25, im:1715, ctr:1.46, pos:12.4 },
  { d:"2026-05-06", cl:22, im:2155, ctr:1.02, pos:11.2 },
  { d:"2026-05-07", cl:10, im:1759, ctr:0.57, pos:13.2 },
];

const SRC_DAILY = [
  { d:"2026-04-09", og:83, pa:39, di:95, re:3, so:2, cr:1, un:0 },
  { d:"2026-04-10", og:50, pa:24, di:92, re:3, so:8, cr:1, un:0 },
  { d:"2026-04-11", og:45, pa:32, di:111, re:7, so:1, cr:1, un:2 },
  { d:"2026-04-12", og:44, pa:63, di:157, re:4, so:2, cr:3, un:2 },
  { d:"2026-04-13", og:90, pa:41, di:122, re:4, so:1, cr:0, un:4 },
  { d:"2026-04-14", og:77, pa:53, di:134, re:11, so:2, cr:0, un:4 },
  { d:"2026-04-15", og:74, pa:49, di:111, re:0, so:2, cr:1, un:1 },
  { d:"2026-04-16", og:85, pa:56, di:111, re:3, so:2, cr:0, un:3 },
  { d:"2026-04-17", og:67, pa:27, di:115, re:0, so:0, cr:0, un:2 },
  { d:"2026-04-18", og:40, pa:46, di:262, re:0, so:0, cr:0, un:0 },
  { d:"2026-04-19", og:48, pa:37, di:133, re:1, so:2, cr:0, un:2 },
  { d:"2026-04-20", og:107, pa:79, di:73, re:0, so:0, cr:0, un:3 },
  { d:"2026-04-21", og:103, pa:57, di:65, re:8, so:2, cr:1, un:4 },
  { d:"2026-04-22", og:111, pa:45, di:86, re:0, so:3, cr:0, un:2 },
  { d:"2026-04-23", og:84, pa:42, di:93, re:4, so:2, cr:0, un:2 },
  { d:"2026-04-24", og:83, pa:33, di:76, re:0, so:1, cr:3, un:1 },
  { d:"2026-04-25", og:58, pa:55, di:52, re:1, so:1, cr:0, un:0 },
  { d:"2026-04-26", og:61, pa:71, di:61, re:1, so:0, cr:1, un:6 },
  { d:"2026-04-27", og:82, pa:55, di:106, re:4, so:5, cr:2, un:4 },
  { d:"2026-04-28", og:113, pa:40, di:37, re:1, so:2, cr:0, un:4 },
  { d:"2026-04-29", og:105, pa:47, di:31, re:0, so:2, cr:0, un:1 },
  { d:"2026-04-30", og:72, pa:43, di:57, re:1, so:0, cr:0, un:3 },
  { d:"2026-05-01", og:69, pa:45, di:54, re:2, so:1, cr:4, un:4 },
  { d:"2026-05-02", og:53, pa:45, di:30, re:2, so:0, cr:1, un:1 },
  { d:"2026-05-03", og:60, pa:48, di:25, re:4, so:0, cr:1, un:3 },
  { d:"2026-05-04", og:73, pa:67, di:30, re:4, so:0, cr:1, un:0 },
  { d:"2026-05-05", og:88, pa:73, di:43, re:9, so:0, cr:1, un:1 },
  { d:"2026-05-06", og:68, pa:107, di:35, re:4, so:4, cr:2, un:2 },
  { d:"2026-05-07", og:51, pa:96, di:44, re:3, so:0, cr:3, un:3 },
  { d:"2026-05-08", og:53, pa:88, di:38, re:0, so:6, cr:1, un:1 },
  { d:"2026-05-09", og:20, pa:9, di:6, re:2, so:0, cr:17, un:34 },
];

// Static data (not date-filtered)
const topPages = [
  { page: "/", views: 905, pct: 24.9 },
  { page: "/tents-and-canopies/", views: 320, pct: 8.8 },
  { page: "/tables/", views: 298, pct: 8.2 },
  { page: "/categories/", views: 293, pct: 8.1 },
  { page: "/chairs/", views: 248, pct: 6.8 },
  { page: "/tent-table-and-chair-packages/", views: 188, pct: 5.2 },
  { page: "/stages-rental/", views: 113, pct: 3.1 },
  { page: "/dance-floor-rentals/", views: 111, pct: 3.1 },
  { page: "/tablecloths/", views: 96, pct: 2.6 },
  { page: "/marquee-letters-rentals/", views: 86, pct: 2.4 },
];

const campaignData = [
  { campaign: "Tent & Canopy - NJ", spend: 162.43, clicks: 149, impressions: 1688, ctr: 8.8, conversions: 0, cpc: 1.09 },
  { campaign: "Party Rentals - NJ", spend: 121.58, clicks: 71, impressions: 795, ctr: 8.9, conversions: 6, cpc: 1.71 },
  { campaign: "Tent & Canopy - Bergen", spend: 83.18, clicks: 78, impressions: 756, ctr: 10.3, conversions: 0, cpc: 1.07 },
  { campaign: "Table Rental - Morris", spend: 61.09, clicks: 29, impressions: 297, ctr: 9.8, conversions: 1, cpc: 2.11 },
  { campaign: "Stage Rental - Bergen", spend: 61.40, clicks: 28, impressions: 285, ctr: 9.8, conversions: 0, cpc: 2.19 },
  { campaign: "Party Rentals - Morris", spend: 52.07, clicks: 30, impressions: 294, ctr: 10.2, conversions: 0, cpc: 1.74 },
  { campaign: "Chair Rental - Morris", spend: 41.09, clicks: 19, impressions: 110, ctr: 17.3, conversions: 0, cpc: 2.16 },
  { campaign: "Lawn Games - Bergen", spend: 28.96, clicks: 20, impressions: 288, ctr: 6.9, conversions: 0, cpc: 1.45 },
  { campaign: "Table Rental - Bergen", spend: 26.31, clicks: 27, impressions: 246, ctr: 11.0, conversions: 1, cpc: 0.97 },
  { campaign: "Stage Rental - Manhattan", spend: 22.72, clicks: 23, impressions: 184, ctr: 12.5, conversions: 0, cpc: 0.99 },
];

const topQueries = [
  { query: "the event rental guys", clicks: 8, impressions: 45, ctr: 17.8, position: 1.1 },
  { query: "event rental guys", clicks: 3, impressions: 16, ctr: 18.8, position: 1.1 },
  { query: "backyard wedding rental packages", clicks: 2, impressions: 5, ctr: 40.0, position: 9.0 },
  { query: "dance floor rental nj", clicks: 2, impressions: 8, ctr: 25.0, position: 3.6 },
  { query: "table and chair rentals nj", clicks: 2, impressions: 32, ctr: 6.3, position: 5.1 },
  { query: "backyard games rental", clicks: 1, impressions: 3, ctr: 33.3, position: 4.7 },
  { query: "marquee letter rental near me", clicks: 1, impressions: 2, ctr: 50.0, position: 1.0 },
  { query: "nj wedding rentals", clicks: 1, impressions: 3, ctr: 33.3, position: 5.7 },
  { query: "chair rental", clicks: 1, impressions: 17, ctr: 5.9, position: 8.1 },
  { query: "dance floor rental near me", clicks: 1, impressions: 9, ctr: 11.1, position: 8.6 },
];

// Helper to compute marketing metrics for a date range
const computeMktMetrics = (fromStr, toStr) => {
  const from = new Date(fromStr + "T00:00:00");
  const to = new Date(toStr + "T00:00:00");
  const rangeDays = Math.round((to - from) / 86400000) + 1;
  const prevTo = new Date(from); prevTo.setDate(prevTo.getDate() - 1);
  const prevFrom = new Date(prevTo); prevFrom.setDate(prevFrom.getDate() - rangeDays + 1);
  const pf = prevFrom.toISOString().slice(0, 10);
  const pt = prevTo.toISOString().slice(0, 10);

  const inRange = (d) => d >= fromStr && d <= toStr;
  const inPrev = (d) => d >= pf && d <= pt;

  const ga4R = GA4_DAILY.filter(x => inRange(x.d));
  const ga4P = GA4_DAILY.filter(x => inPrev(x.d));
  const sumGA4 = (arr) => ({ sessions: arr.reduce((a, x) => a + x.s, 0), pageviews: arr.reduce((a, x) => a + x.pv, 0), users: arr.reduce((a, x) => a + x.u, 0), newUsers: arr.reduce((a, x) => a + x.nu, 0) });

  const adsR = ADS_DAILY.filter(x => inRange(x.d));
  const adsP = ADS_DAILY.filter(x => inPrev(x.d));
  const sumAds = (arr) => ({ spend: Math.round(arr.reduce((a, x) => a + x.sp, 0) * 100) / 100, clicks: arr.reduce((a, x) => a + x.cl, 0), impressions: arr.reduce((a, x) => a + x.im, 0), conversions: Math.round(arr.reduce((a, x) => a + x.cv, 0)) });

  const scR = SC_DAILY.filter(x => inRange(x.d));
  const scP = SC_DAILY.filter(x => inPrev(x.d));
  const sumSC = (arr) => {
    const cl = arr.reduce((a, x) => a + x.cl, 0);
    const im = arr.reduce((a, x) => a + x.im, 0);
    return { clicks: cl, impressions: im, ctr: im > 0 ? Math.round(cl / im * 10000) / 100 : 0, position: im > 0 ? Math.round(arr.reduce((a, x) => a + x.pos * x.im, 0) / im * 10) / 10 : 0 };
  };

  const srcR = SRC_DAILY.filter(x => inRange(x.d));
  const srcAgg = { "Organic Search": 0, "Paid Search": 0, "Direct": 0, "Referral": 0, "Organic Social": 0, "Cross-network": 0, "Unassigned": 0 };
  srcR.forEach(x => { srcAgg["Organic Search"] += x.og; srcAgg["Paid Search"] += x.pa; srcAgg["Direct"] += x.di; srcAgg["Referral"] += x.re; srcAgg["Organic Social"] += x.so; srcAgg["Cross-network"] += x.cr; srcAgg["Unassigned"] += x.un; });
  const sourcesPie = Object.entries(srcAgg).map(([name, sessions]) => ({ name, sessions })).filter(x => x.sessions > 0).sort((a, b) => b.sessions - a.sessions);

  const dailyChart = ga4R.map(x => ({ label: new Date(x.d + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }), sessions: x.s, pageviews: x.pv }));

  const adsCur = sumAds(adsR); const adsPrv = sumAds(adsP);
  return {
    fromStr, toStr, prevFromStr: pf, prevToStr: pt, rangeDays,
    ga4: sumGA4(ga4R), ga4Prev: sumGA4(ga4P),
    ads: adsCur, adsPrev: adsPrv,
    adsCPC: adsCur.clicks > 0 ? Math.round(adsCur.spend / adsCur.clicks * 100) / 100 : 0,
    adsPrevCPC: adsPrv.clicks > 0 ? Math.round(adsPrv.spend / adsPrv.clicks * 100) / 100 : 0,
    sc: sumSC(scR), scPrev: sumSC(scP),
    sourcesPie, dailyChart,
    dateLabel: `${new Date(fromStr + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${new Date(toStr + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`,
  };
};

// ── Formatters ──
const fmt = (n) => {
  if (n >= 1000000) return `$${(n / 1000000).toFixed(2)}M`;
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
};

const fmtFull = (n) =>
  Number.isFinite(n) ? "$" + n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 }) : "—";

// ── Components ──
const TodayCard = ({ icon: Icon, label, value, compareValue, compareLabel, color, colorLight, isCurrency, emailPartial = false, comparePartial = false, lowerIsBetter = false }) => {
  const numVal = isCurrency ? (typeof value === "number" ? value : parseFloat(String(value).replace(/[$,]/g, ""))) : value;
  const comparable = Number.isFinite(numVal) && Number.isFinite(compareValue) && !emailPartial && !comparePartial;
  const diff = numVal - compareValue;
  const isUp = diff > 0;
  const isEqual = diff === 0;
  const pctChange = compareValue === 0 ? (numVal > 0 ? 100 : 0) : Math.round(Math.abs(diff) / compareValue * 100);
  return (
    <div style={{
      background: COLORS.cardBg, border: `1px solid ${COLORS.cardBorder}`, borderRadius: 14,
      padding: "22px 24px", display: "flex", alignItems: "center", gap: 16,
      boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
    }}>
      <div style={{
        background: colorLight, borderRadius: 12, padding: 12,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <Icon size={22} color={color} />
      </div>
      <div>
        <div style={{ color: COLORS.textMuted, fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px" }}>{label}</div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 2 }}>
          <span style={{ fontSize: 28, fontWeight: 700, color: COLORS.text }}>{isCurrency ? fmtFull(numVal) : displayEmailCount(numVal, emailPartial)}</span>
          {comparable && !isEqual && (
            <span style={{ fontSize: 13, fontWeight: 600, color: isUp !== lowerIsBetter ? COLORS.green : COLORS.red }}>
              {isUp ? "▲" : "▼"}{isCurrency ? `${pctChange}%` : Math.abs(diff)}
            </span>
          )}
        </div>
        <div style={{ fontSize: 11, marginTop: 2, color: COLORS.textMuted }}>
          {compareLabel}: {isCurrency ? fmtFull(compareValue) : displayEmailCount(compareValue, comparePartial)}
        </div>
      </div>
    </div>
  );
};

const WeekCard = ({ icon: Icon, label, total, compareTotal, data, dataKey, color, colorLight, isCurrency, emailPartial = false, comparePartial = false }) => {
  const [hoveredDay, setHoveredDay] = useState(null);
  const totalNum = isCurrency ? parseFloat(String(total).replace(/[$,]/g, "")) : total;
  const comparable = Number.isFinite(totalNum) && Number.isFinite(compareTotal) && !emailPartial && !comparePartial;
  const diff = totalNum - compareTotal;
  const isUp = diff > 0;
  const isEqual = diff === 0;
  const pctChange = compareTotal === 0 ? (totalNum > 0 ? 100 : 0) : Math.round(Math.abs(diff) / compareTotal * 100);
  const displayCompare = isCurrency ? fmtFull(compareTotal) : displayEmailCount(compareTotal, comparePartial);
  return (
    <div style={{
      background: COLORS.cardBg, border: `1px solid ${COLORS.cardBorder}`, borderRadius: 14,
      padding: "20px 24px", boxShadow: "0 1px 3px rgba(0,0,0,0.04)", position: "relative",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 2 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ background: colorLight, borderRadius: 8, padding: 8, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon size={16} color={color} />
          </div>
          <span style={{ color: COLORS.textMuted, fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px" }}>{label}</span>
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginLeft: "auto" }}>
          <span style={{ fontSize: 22, fontWeight: 700, color: COLORS.text }}>{isCurrency ? total : displayEmailCount(total, emailPartial)}</span>
          {comparable && !isEqual && (
            <span style={{ fontSize: 12, fontWeight: 600, color: isUp ? COLORS.green : COLORS.red }}>
              {isUp ? "▲" : "▼"}{isCurrency ? `${pctChange}%` : Math.abs(diff)}
            </span>
          )}
        </div>
      </div>
      <div style={{ fontSize: 11, color: COLORS.textMuted, marginBottom: 12, textAlign: "right" }}>
        Last wk: {displayCompare}
      </div>
      <div style={{ display: "flex", gap: 2, alignItems: "flex-end", height: 48, position: "relative" }}>
        {data.map((d, i) => {
          const max = Math.max(...data.map((x) => x[dataKey]), 1);
          const h = (d[dataKey] / max) * 100;
          const isToday = i === new Date().getDay() - 1;
          const isHovered = hoveredDay === i;
          const displayVal = isCurrency ? fmtFull(d[dataKey]) : displayEmailCount(d[dataKey], d.emailPartial && ["wishlists", "forms"].includes(dataKey));
          return (
            <div
              key={d.day}
              style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, position: "relative" }}
              onMouseEnter={() => setHoveredDay(i)}
              onMouseLeave={() => setHoveredDay(null)}
            >
              {isHovered && (
                <div style={{
                  position: "absolute", bottom: "100%", left: "50%", transform: "translateX(-50%)",
                  background: COLORS.text, color: "#fff", padding: "6px 10px", borderRadius: 6,
                  fontSize: 11, fontWeight: 600, whiteSpace: "nowrap", zIndex: 10, marginBottom: 4,
                  boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
                }}>
                  {d.day}: {displayVal}
                  <div style={{
                    position: "absolute", top: "100%", left: "50%", transform: "translateX(-50%)",
                    width: 0, height: 0, borderLeft: "5px solid transparent", borderRight: "5px solid transparent",
                    borderTop: `5px solid ${COLORS.text}`,
                  }} />
                </div>
              )}
              <div style={{
                width: "100%", height: `${d[dataKey] == null ? 0 : Math.max(h, 4)}%`, minHeight: d[dataKey] == null ? 0 : 3,
                background: isHovered ? color : (isToday ? color : `${color}40`),
                borderRadius: 3, cursor: "pointer", transition: "background 0.15s",
              }} />
              <span style={{
                fontSize: 10,
                color: isHovered ? color : (isToday ? color : COLORS.textMuted),
                fontWeight: isToday || isHovered ? 700 : 500,
              }}>{d.day}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const ChartCard = ({ children, style = {} }) => (
  <div style={{
    background: COLORS.cardBg, border: `1px solid ${COLORS.cardBorder}`, borderRadius: 14,
    padding: 24, boxShadow: "0 1px 3px rgba(0,0,0,0.04)", ...style,
  }}>{children}</div>
);

const StaleNote = ({ children, style = {} }) => (
  <div style={{
    display: "flex", alignItems: "flex-start", gap: 10, background: COLORS.orangeLight,
    border: `1px solid ${COLORS.orange}40`, color: "#9a3412", borderRadius: 10,
    padding: "10px 14px", fontSize: 13, lineHeight: 1.45, ...style,
  }}>
    <Clock size={16} color={COLORS.orange} style={{ flexShrink: 0, marginTop: 1 }} />
    <div>{children}</div>
  </div>
);

const SectionTitle = ({ children }) => (
  <h3 style={{ fontSize: 15, fontWeight: 700, color: COLORS.text, margin: "0 0 20px" }}>{children}</h3>
);

// ── Brand Logos (inline SVG) ──
const GA4Logo = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
    <path d="M21.5 12c0 5.25-4.25 9.5-9.5 9.5S2.5 17.25 2.5 12 6.75 2.5 12 2.5 21.5 6.75 21.5 12z" fill="#F9AB00" opacity="0.15"/>
    <rect x="3" y="14" width="4" height="7" rx="1.5" fill="#F9AB00"/>
    <rect x="10" y="9" width="4" height="12" rx="1.5" fill="#E37400"/>
    <circle cx="19" cy="5" r="3" fill="#F9AB00"/>
    <path d="M17 7l-3 4" stroke="#E37400" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
);

const GoogleAdsLogo = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
    <path d="M3.28 16.76l5.2-9.01 4.62 2.67-5.2 9.01z" fill="#FBBC04"/>
    <path d="M13.1 10.42l5.2-9.01 4.62 2.67-5.2 9.01z" fill="#4285F4"/>
    <circle cx="5.58" cy="19.08" r="2.92" fill="#34A853"/>
  </svg>
);

const SearchConsoleLogo = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
    <circle cx="10.5" cy="10.5" r="6" stroke="#4285F4" strokeWidth="2.5" fill="none"/>
    <path d="M15 15l5.5 5.5" stroke="#4285F4" strokeWidth="2.5" strokeLinecap="round"/>
    <rect x="8" y="8" width="1.5" height="5" rx="0.75" fill="#4285F4" opacity="0.5"/>
    <rect x="11" y="10" width="1.5" height="3" rx="0.75" fill="#4285F4" opacity="0.5"/>
  </svg>
);

const BrandedSection = ({ logo, title, subtitle, borderColor }) => (
  <div style={{
    display: "flex", alignItems: "center", gap: 12,
    paddingBottom: 16, marginBottom: 20,
    borderBottom: `2px solid ${borderColor}15`,
  }}>
    <div style={{
      background: `${borderColor}10`, borderRadius: 10, padding: 8,
      display: "flex", alignItems: "center", justifyContent: "center",
      border: `1px solid ${borderColor}20`,
    }}>
      {logo}
    </div>
    <div>
      <h3 style={{ fontSize: 15, fontWeight: 700, color: COLORS.text, margin: 0 }}>{title}</h3>
      {subtitle && <p style={{ fontSize: 11, color: COLORS.textMuted, margin: "2px 0 0" }}>{subtitle}</p>}
    </div>
  </div>
);

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: COLORS.cardBg, border: `1px solid ${COLORS.cardBorder}`, borderRadius: 8,
      padding: "10px 14px", fontSize: 13, boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
    }}>
      <div style={{ color: COLORS.text, marginBottom: 6, fontWeight: 600 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: COLORS.text, display: "flex", gap: 8, alignItems: "center", marginBottom: 2 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: p.color, display: "inline-block" }} />
          <span>{p.name}: {typeof p.value === "number" && p.value > 100 ? fmtFull(p.value) : p.value}</span>
        </div>
      ))}
    </div>
  );
};

const getWeekRange = () => {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const opts = { month: "short", day: "numeric" };
  return `${monday.toLocaleDateString("en-US", opts)} – ${sunday.toLocaleDateString("en-US", opts)}, ${sunday.getFullYear()}`;
};

const tabs = ["Overview", "Sales", "Marketing", "Geography", "Team"];

// Bundle hardcoded defaults so the component can fall back before live data loads
const GSP_DEFAULTS = {
  topClients2026: [],
  earnedRevenue2026: { earned: null, earnedCount: null, unearned: null, unearnedCount: null },
  totalSales2026: null, paidContractCount: null, totalPipeline2026,
  gspStatusCounts: { ...gspStatusCounts, contractSigned: 0 },
  todayData: { ...todayData, totalSales: null },
  yesterdayData: { ...yesterdayData, totalSales: null },
  weekData: weekData.map(day => ({ ...day, sales: null, totalSales: null })),
  weekTotals: { ...weekTotals, sales: null }, lastWeekTotals: { ...lastWeekTotals, sales: null },
};

export default function Dashboard() {
  // ── Password Protection ──
  const [dashAuth, setDashAuth] = useState(() => {
    try { return sessionStorage.getItem("dash_auth") === "1"; } catch(e) { return false; }
  });
  const [dashPw, setDashPw] = useState("");
  const [dashPwErr, setDashPwErr] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const [activeTab, setActiveTab] = useState("Overview");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const chooseTab = (tab) => { setActiveTab(tab); setMobileMenuOpen(false); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const [monthRange, setMonthRange] = useState("12");
  const [mktPreset, setMktPreset] = useState("7d");
  const [mktFrom, setMktFrom] = useState("2026-05-03");
  const [mktTo, setMktTo] = useState("2026-05-09");

  // ── Live data from Google Sheets ──
  const [liveData, setLiveData] = useState(null);
  const [emailCounts, setEmailCounts] = useState(null);
  const [communications, setCommunications] = useState(null);
  useEffect(() => {
    fetchLiveGSPData().then(data => { if (data) setLiveData(data); });
    fetchEmailCounts().then(setEmailCounts);
    fetchCommunications().then(setCommunications);
  }, []);

  // Destructure live data (or fall back to hardcoded defaults defined above)
  const {
    todayData, yesterdayData, weekData, weekTotals, lastWeekTotals, phone,
    topClients2026, earnedRevenue2026, totalSales2026, paidContractCount, totalPipeline2026, gspStatusCounts,
  } = applyCommunications(applyEmailCounts(liveData ?? GSP_DEFAULTS, emailCounts), communications);

  // Future days stay empty instead of suggesting zero completed activity.
  const nyWeekday = new Intl.DateTimeFormat("en-US", { timeZone: EMAIL_TIME_ZONE, weekday: "short" }).format(new Date());
  const elapsedDayIndex = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(nyWeekday);
  const dailyChartData = weekData.map((day, index) => index <= elapsedDayIndex ? day : {
    ...day, wishlists: null, forms: null, directEmails: null, inquiries: null, quotesCreated: null, quotesSent: null, contracts: null, sales: null,
  });

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const [data, counts, comms] = await Promise.all([fetchLiveGSPData(), fetchEmailCounts(), fetchCommunications()]);
      if (data) setLiveData(data);
      setEmailCounts(counts);
      setCommunications(comms);
    } finally {
      setRefreshing(false);
    }
  };

  const effectiveMonthlyData = useMemo(() => liveData?.liveMonthly ?? [], [liveData]);

  // ── Year cards: totals per year from the monthly data; the latest year is
  // compared with the same months of the year before ──
  const yearCards = useMemo(() => {
    const byYear = {};
    effectiveMonthlyData.forEach(m => {
      const y = 2000 + parseInt(m.m.split(" ")[1]);
      if (!byYear[y]) byYear[y] = { year: y, revenue: 0, count: 0, months: [] };
      byYear[y].revenue += m.revenue; byYear[y].count += m.count;
      byYear[y].months.push(m.m.split(" ")[0]);
    });
    const years = Object.values(byYear).sort((a, b) => a.year - b.year);
    const latest = years[years.length - 1]?.year;
    return years.map((y, i) => {
      const prev = years[i - 1];
      const isYTD = y.year === latest && y.months.length < 12;
      let growth = null, compareLabel = null;
      if (prev) {
        const prevRev = isYTD
          ? effectiveMonthlyData.filter(m => m.m.endsWith(String(prev.year).slice(-2)) && y.months.includes(m.m.split(" ")[0])).reduce((s, m) => s + m.revenue, 0)
          : prev.revenue;
        growth = prevRev > 0 ? Math.round((y.revenue - prevRev) / prevRev * 1000) / 10 : null;
        compareLabel = isYTD ? `vs ${y.months[0]}–${y.months[y.months.length - 1]} ${prev.year}` : `vs ${prev.year}`;
      }
      return {
        year: isYTD ? `${y.year} YTD` : String(y.year),
        revenue: Math.round(y.revenue), count: y.count,
        aov: y.count ? Math.round(y.revenue / y.count) : 0,
        growth, compareLabel,
      };
    });
  }, [effectiveMonthlyData]);

  // ── Data freshness ──
  const daysOld = (d) => d ? Math.floor((new Date() - d) / 86400000) : null;
  const fmtDate = (d) => d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";
  const exportDate = liveData?.exportInfo?.date || null;
  const salesStale = exportDate ? daysOld(exportDate) > 2 : false;
  const mktLastDate = GA4_DAILY.length ? new Date(GA4_DAILY[GA4_DAILY.length - 1].d + "T12:00:00") : null;
  const mktStale = mktLastDate ? daysOld(mktLastDate) > 3 : false;

  const filteredMonthly = useMemo(() => {
    if (monthRange === "12") return effectiveMonthlyData.slice(-12);
    if (monthRange === "6") return effectiveMonthlyData.slice(-6);
    return effectiveMonthlyData;
  }, [monthRange, effectiveMonthlyData]);

  const mktLatest = GA4_DAILY.length > 0 ? GA4_DAILY[GA4_DAILY.length - 1].d : new Date().toISOString().slice(0, 10);
  const mktDates = useMemo(() => {
    const sub = (iso, n) => { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
    if (mktPreset === "7d") return { from: sub(mktLatest, 6), to: mktLatest };
    if (mktPreset === "14d") return { from: sub(mktLatest, 13), to: mktLatest };
    if (mktPreset === "30d") return { from: sub(mktLatest, 29), to: mktLatest };
    return { from: mktFrom, to: mktTo };
  }, [mktPreset, mktFrom, mktTo, mktLatest]);

  const mkt = useMemo(() => computeMktMetrics(mktDates.from, mktDates.to), [mktDates]);

  // ── Auth Gate ──
  if (!dashAuth) {
    const checkPw = (e) => {
      e.preventDefault();
      if (btoa(dashPw) === "R1JPVkVSVExPVkVTQ0xBVURF") {
        setDashAuth(true);
        try { sessionStorage.setItem("dash_auth", "1"); } catch(ex) {}
      } else { setDashPwErr(true); }
    };
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg, #1B1A32 0%, #2D2B55 50%, #1B1A32 100%)", fontFamily: "Inter, -apple-system, sans-serif" }}>
        <form onSubmit={checkPw} style={{ background: "rgba(255,255,255,0.07)", borderRadius: 20, padding: "48px 40px", width: 380, textAlign: "center", border: "1px solid rgba(255,255,255,0.12)", boxShadow: "0 25px 60px rgba(0,0,0,0.4)" }}>
          <img src={LOGO_URL} alt="Logo" style={{ height: 60, marginBottom: 24 }} />
          <h2 style={{ color: "#fff", margin: "0 0 8px", fontSize: 22, fontWeight: 700 }}>Business Dashboard</h2>
          <p style={{ color: "rgba(255,255,255,0.5)", margin: "0 0 32px", fontSize: 14 }}>Enter password to continue</p>
          <input type="password" value={dashPw} onChange={(ev) => { setDashPw(ev.target.value); setDashPwErr(false); }} placeholder="Password" autoFocus style={{ width: "100%", padding: "14px 16px", fontSize: 15, borderRadius: 10, border: dashPwErr ? "2px solid #ef4444" : "2px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.08)", color: "#fff", outline: "none", boxSizing: "border-box" }} />
          {dashPwErr && <p style={{ color: "#ef4444", fontSize: 13, margin: "8px 0 0" }}>Incorrect password</p>}
          <button type="submit" style={{ width: "100%", padding: 14, marginTop: 20, fontSize: 15, fontWeight: 600, borderRadius: 10, border: "none", cursor: "pointer", color: "#fff", background: "linear-gradient(135deg, #7674B6, #5C5A9E)", boxShadow: "0 4px 15px rgba(118,116,182,0.4)" }}>Sign In</button>
        </form>
      </div>
    );
  }

  return (
    <div style={{
      background: COLORS.bg, minHeight: "100vh", color: COLORS.text,
      fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <button className="terg-menu-toggle" type="button" aria-label="Open page menu" aria-expanded={mobileMenuOpen} aria-controls="terg-mobile-drawer" onClick={() => setMobileMenuOpen(true)}>
        <span aria-hidden="true">☰</span><span>Menu</span>
      </button>
      {mobileMenuOpen && <div className="terg-drawer-backdrop" onClick={() => setMobileMenuOpen(false)} />}
      <aside id="terg-mobile-drawer" className={mobileMenuOpen ? "terg-mobile-drawer is-open" : "terg-mobile-drawer"} aria-hidden={!mobileMenuOpen} aria-label="Dashboard pages">
        <div className="terg-drawer-head"><strong>TERG Dashboard</strong><button type="button" aria-label="Close page menu" onClick={() => setMobileMenuOpen(false)}>✕</button></div>
        <nav aria-label="Mobile dashboard navigation">{tabs.map(t => <button tabIndex={mobileMenuOpen ? 0 : -1} type="button" key={t} className={activeTab === t ? "is-active" : ""} onClick={() => chooseTab(t)}>{t}<span>›</span></button>)}</nav>
        <small>Sales and activity data are shown as of their individual source updates.</small>
      </aside>
      {/* ── Header ── */}
      <div style={{ background: COLORS.headerBg, padding: "18px 32px" }}>
        <div style={{ maxWidth: 1400, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <img
              src={LOGO_URL}
              alt="The Event Rental Guys"
              style={{ height: 50, width: "auto", maxWidth: 200, objectFit: "contain" }}
              onError={(e) => { e.target.style.display = "none"; e.target.nextSibling.style.display = "block"; }}
            />
            <span style={{ display: "none", color: "#fff", fontSize: 16, fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", lineHeight: 1.2 }}>
              The Event<br />Rental Guys
            </span>
            <div style={{ width: 1, height: 32, background: "rgba(255,255,255,0.15)" }} />
            <div>
              <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0, color: "#FFFFFF" }}>Business Dashboard</h1>
              <p style={{ color: "rgba(255,255,255,0.55)", fontSize: 12, margin: "2px 0 0" }}>
                {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
                {exportDate && (
                  <span style={{ marginLeft: 10, color: salesStale ? "#fdba74" : "rgba(255,255,255,0.55)" }}>
                    · Sales data as of {fmtDate(exportDate)}
                  </span>
                )}
              </p>
            </div>
          <button onClick={handleRefresh} disabled={refreshing} style={{ background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 8, padding: "8px 16px", color: "#fff", cursor: refreshing ? "wait" : "pointer", fontSize: 13, fontWeight: 500, display: "flex", alignItems: "center", gap: 6, opacity: refreshing ? 0.6 : 1, transition: "all 0.2s", marginLeft: 8 }}>
            <Activity size={14} style={refreshing ? { animation: "spin 1s linear infinite" } : {}} />
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 4, background: "rgba(255,255,255,0.08)", borderRadius: 10, padding: 4 }}>
            {tabs.map((t) => (
              <button key={t} onClick={() => chooseTab(t)} style={{
                padding: "8px 18px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600,
                background: activeTab === t ? COLORS.accent : "transparent",
                color: activeTab === t ? "#FFFFFF" : "rgba(255,255,255,0.5)",
              }}>{t}</button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1400, margin: "0 auto", padding: "28px 32px 48px" }}>

        {/* ══════════════════ TABBED SECTIONS ══════════════════ */}

        {/* OVERVIEW TAB */}
        {activeTab === "Overview" && (
          <>
            <StaleNote style={{ marginBottom: 20 }}>
              {liveData ? "Sales include Contract Signed projects with billing status Paid, grouped by First Signed Date. Paid status is evaluated as of the latest export." : "Loading verified paid sales. If the source cannot be read, sales stay unavailable rather than using saved estimates."}
            </StaleNote>

            {salesStale && (
              <StaleNote style={{ marginBottom: 20 }}>
                <strong>Sales numbers are from the Goodshuffle export of {fmtDate(exportDate)}</strong> ({daysOld(exportDate)} days ago).
                {" "}Today and This Week will show zeros until a newer export is pasted into the Master GSP sheet.
              </StaleNote>
            )}
            <StaleNote style={{ marginBottom: 20 }}>
              <strong>Email lead counts:</strong>{" "}
              {emailCounts?.days?.length ? (
                <>Verified so far as of {new Date(emailCounts.days.reduce((latest, row) => row.asOf > latest ? row.asOf : latest, "")).toLocaleString("en-US", { timeZone: EMAIL_TIME_ZONE, month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" })}.</>
              ) : "Unavailable — awaiting a verified mailbox scan."}
              {" "}Today and this week are totals so far; weekly comparisons use the full previous week. A + means incomplete coverage; — means unverified. Counts use New York received dates.
            </StaleNote>
            {/* ══════════════════ TODAY ══════════════════ */}
            <div style={{ marginBottom: 8 }}>
              <h2 style={{ fontSize: 15, fontWeight: 700, color: COLORS.text, margin: "0 0 4px", textTransform: "uppercase", letterSpacing: "0.5px" }}>Today</h2>
              <p style={{ color: COLORS.textMuted, fontSize: 13, margin: 0 }}>
                {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
              </p>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 16, marginBottom: 14 }}>
              <TodayCard icon={CreditCard} label="Contracts Signed" value={todayData.contracts} compareValue={yesterdayData.contracts} compareLabel="Yesterday" color={COLORS.accentDark} colorLight={COLORS.accentLight} />
              <TodayCard icon={DollarSign} label="Total Sales" value={todayData.totalSales} compareValue={yesterdayData.totalSales} compareLabel="Yesterday" color={COLORS.blue} colorLight={COLORS.blueLight} isCurrency />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 14, marginBottom: 32 }}>
              <TodayCard icon={Send} label="Quotes Sent" value={todayData.quotesSent} compareValue={yesterdayData.quotesSent} compareLabel="Yesterday" color={COLORS.orange} colorLight={COLORS.orangeLight} />
              <TodayCard icon={ClipboardList} label="Wishlists Received" value={todayData.wishlists} compareValue={yesterdayData.wishlists} emailPartial={todayData.emailPartial} comparePartial={yesterdayData.emailPartial} compareLabel="Yesterday" color={COLORS.purple} colorLight={COLORS.purpleLight} />
              <TodayCard icon={FileText} label="Forms Received" value={todayData.forms} compareValue={yesterdayData.forms} emailPartial={todayData.emailPartial} comparePartial={yesterdayData.emailPartial} compareLabel="Yesterday" color={COLORS.cyan} colorLight="#cffafe" />
              <TodayCard icon={Mail} label="Direct Email Inquiries" value={todayData.directEmails} compareValue={yesterdayData.directEmails} compareLabel="Yesterday" color={COLORS.orange} colorLight={COLORS.orangeLight} />
            </div>

            {/* ══════════════════ THIS WEEK ══════════════════ */}
            <div style={{ marginBottom: 8 }}>
              <h2 style={{ fontSize: 15, fontWeight: 700, color: COLORS.text, margin: "0 0 4px", textTransform: "uppercase", letterSpacing: "0.5px" }}>This Week</h2>
              <p style={{ color: COLORS.textMuted, fontSize: 13, margin: 0 }}>{getWeekRange()}</p>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14, marginBottom: 40 }}>
              <WeekCard icon={CreditCard} label="Contracts Signed" total={weekTotals.contracts} compareTotal={lastWeekTotals.contracts} data={weekData} dataKey="contracts" color={COLORS.accentDark} colorLight={COLORS.accentLight} />
              <WeekCard icon={DollarSign} label="Total Sales" total={fmtFull(weekTotals.sales)} compareTotal={lastWeekTotals.sales} data={weekData} dataKey="sales" color={COLORS.blue} colorLight={COLORS.blueLight} isCurrency />
              <WeekCard icon={Send} label="Quotes Sent" total={weekTotals.quotesSent} compareTotal={lastWeekTotals.quotesSent} data={weekData} dataKey="quotesSent" color={COLORS.orange} colorLight={COLORS.orangeLight} />
              <WeekCard icon={ClipboardList} label="Wishlists Received" total={weekTotals.wishlists} compareTotal={lastWeekTotals.wishlists} emailPartial={weekTotals.emailPartial} comparePartial={lastWeekTotals.emailPartial} data={weekData} dataKey="wishlists" color={COLORS.purple} colorLight={COLORS.purpleLight} />
              <WeekCard icon={FileText} label="Forms Received" total={weekTotals.forms} compareTotal={lastWeekTotals.forms} emailPartial={weekTotals.emailPartial} comparePartial={lastWeekTotals.emailPartial} data={weekData} dataKey="forms" color={COLORS.cyan} colorLight="#cffafe" />
              <WeekCard icon={Mail} label="Direct Email Inquiries" total={weekTotals.directEmails} compareTotal={lastWeekTotals.directEmails} data={weekData} dataKey="directEmails" color={COLORS.orange} colorLight={COLORS.orangeLight} />
            </div>

            {/* ══════════════════ DIVIDER ══════════════════ */}
            <div style={{ borderTop: `1px solid ${COLORS.cardBorder}`, marginBottom: 32 }} />
            {/* Daily activity and sales use separate scales. */}
            <ChartCard style={{ marginBottom: 24 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 20, flexWrap: "wrap" }}>
                <div>
                  <SectionTitle>Incoming Inquiries — This Week</SectionTitle>
                  <p style={{ color: COLORS.textMuted, fontSize: 13, margin: "-4px 0 20px" }}>Forms + Wishlists + new direct email inquiries</p>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 32, fontWeight: 700, color: COLORS.text }}>{displayEmailCount(weekTotals.inquiries, weekTotals.inquiryPartial)}</div>
                  <div style={{ fontSize: 12, color: COLORS.textMuted }}>inquiries so far · Last week: {displayEmailCount(lastWeekTotals.inquiries, lastWeekTotals.inquiryPartial)}</div>
                  <div style={{ fontSize: 12, color: COLORS.textMuted, marginTop: 4 }}>Today: {displayEmailCount(todayData.inquiries, todayData.inquiryPartial)}</div>
                </div>
              </div>
              <p style={{ color: COLORS.textMuted, fontSize: 12, margin: "0 0 16px" }}>
                New direct requests exclude replies, existing-project conversations, vendor emails, and form or Wishlist follow-ups.
                {" "}{communications ? `Direct email and phone data verified ${new Date(communications.asOf).toLocaleString("en-US", { timeZone: EMAIL_TIME_ZONE, month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" })}.` : "Direct email and phone data are awaiting a verified scan."}
              </p>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={dailyChartData} margin={{ top: 12, right: 20, left: 0, bottom: 8 }} barCategoryGap="32%">
                  <CartesianGrid vertical={false} strokeDasharray="3 3" stroke={COLORS.cardBorder} />
                  <XAxis dataKey="day" tick={{ fill: COLORS.textMuted, fontSize: 12 }} axisLine={false} tickLine={false} tickMargin={10} />
                  <YAxis allowDecimals={false} tick={{ fill: COLORS.textMuted, fontSize: 11 }} axisLine={false} tickLine={false} width={44} />
                  <Tooltip cursor={{ fill: COLORS.accentLight, fillOpacity: 0.45 }} formatter={(value, name) => [Number(value).toLocaleString("en-US"), name]} contentStyle={{ borderRadius: 10, border: `1px solid ${COLORS.cardBorder}`, boxShadow: "0 4px 16px rgba(0,0,0,0.08)" }} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, paddingTop: 14 }} />
                  <Bar stackId="activity" dataKey="wishlists" name="Wishlists Received" fill={COLORS.purple} maxBarSize={52} />
                  <Bar stackId="activity" dataKey="forms" name="Forms Received" fill={COLORS.cyan} maxBarSize={52} />
                  <Bar stackId="activity" dataKey="directEmails" name="New Direct Email Inquiries" fill={COLORS.orange} radius={[5, 5, 0, 0]} maxBarSize={52} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard style={{ marginBottom: 24 }}>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 16 }}>
                  <h3 style={{ margin: 0, color: COLORS.text, fontSize: 14, fontWeight: 600 }}>Daily Sales</h3>
                  <span style={{ color: COLORS.textMuted, fontSize: 12 }}>Sales in dollars</span>
                </div>
                <ResponsiveContainer width="100%" height={190}>
                  <LineChart data={dailyChartData} margin={{ top: 12, right: 20, left: 0, bottom: 8 }}>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" stroke={COLORS.cardBorder} />
                    <XAxis dataKey="day" tick={{ fill: COLORS.textMuted, fontSize: 12 }} axisLine={false} tickLine={false} tickMargin={10} />
                    <YAxis tick={{ fill: COLORS.textMuted, fontSize: 11 }} tickFormatter={fmt} axisLine={false} tickLine={false} width={64} domain={[0, "auto"]} />
                    <Tooltip formatter={(value) => [fmtFull(value), "Total Sales"]} contentStyle={{ borderRadius: 10, border: `1px solid ${COLORS.cardBorder}`, boxShadow: "0 4px 16px rgba(0,0,0,0.08)" }} />
                    <Line type="linear" dataKey="sales" name="Total Sales" stroke={COLORS.blue} strokeWidth={3} dot={{ r: 4, fill: COLORS.cardBg, strokeWidth: 2 }} activeDot={{ r: 6 }} connectNulls={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </ChartCard>

            <ChartCard style={{ marginBottom: 24 }}>
              <SectionTitle>RingCentral — Calls &amp; Voicemail</SectionTitle>
              <p style={{ color: COLORS.textMuted, fontSize: 13, margin: "-4px 0 20px" }}>
                This week so far · {communications?.phoneScope || "Connected extension unavailable"} · Extension activity only
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 14 }}>
                <TodayCard icon={PhoneIncoming} label="Incoming Calls" value={phone.thisWeek.incomingCalls} compareValue={phone.lastWeek.incomingCalls} compareLabel="Last week" color={COLORS.blue} colorLight={COLORS.blueLight} />
                <TodayCard icon={PhoneCall} label="Answered Calls" value={phone.thisWeek.answeredCalls} compareValue={phone.lastWeek.answeredCalls} compareLabel="Last week" color={COLORS.green} colorLight={COLORS.greenLight} />
                <TodayCard icon={PhoneMissed} label="Missed Calls" lowerIsBetter value={phone.thisWeek.missedCalls} compareValue={phone.lastWeek.missedCalls} compareLabel="Last week" color={COLORS.orange} colorLight={COLORS.orangeLight} />
                <TodayCard icon={Voicemail} label="Voicemails" value={phone.thisWeek.voicemails} compareValue={phone.lastWeek.voicemails} compareLabel="Last week" color={COLORS.purple} colorLight={COLORS.purpleLight} />
              </div>
              <p style={{ color: COLORS.textMuted, fontSize: 12, margin: "16px 0 0" }}>
                Today: {displayEmailCount(phone.today.incomingCalls)} incoming · {displayEmailCount(phone.today.answeredCalls)} answered · {displayEmailCount(phone.today.missedCalls)} missed · {displayEmailCount(phone.today.voicemails)} voicemails.
                {" "}Answered includes calls answered elsewhere; missed includes calls routed to voicemail. Voicemails count available messages.
                {" "}Phone activity is separate from inquiry totals because calls may concern existing projects.
              </p>
            </ChartCard>

            {/* YoY Growth Cards */}
            <SectionTitle>Paid Sales — Year-over-Year</SectionTitle>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16, marginBottom: 32 }}>
              {yearCards.map((y) => (
                <ChartCard key={y.year}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                      <div style={{ color: COLORS.textMuted, fontSize: 13, fontWeight: 600 }}>{y.year}</div>
                      <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4 }}>{fmtFull(y.revenue)}</div>
                      <div style={{ color: COLORS.textMuted, fontSize: 13, marginTop: 4 }}>{y.count} projects · {fmtFull(y.aov)} AOV</div>
                    </div>
                    {y.growth !== null && (
                      <div style={{ textAlign: "right" }}>
                        <div style={{
                          background: `${y.growth >= 0 ? COLORS.green : COLORS.red}15`,
                          color: y.growth >= 0 ? COLORS.green : COLORS.red,
                          padding: "6px 12px", borderRadius: 8, fontWeight: 700, fontSize: 14,
                          display: "inline-flex", alignItems: "center", gap: 4,
                        }}>
                          {y.growth >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                          {`${y.growth >= 0 ? "+" : ""}${y.growth}%`}
                        </div>
                        <div style={{ color: COLORS.textMuted, fontSize: 11, marginTop: 4 }}>{y.compareLabel}</div>
                      </div>
                    )}
                  </div>
                </ChartCard>
              ))}
            </div>

            {/* Revenue Trend + Breakdown */}
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16, marginBottom: 32 }}>
              <ChartCard>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                  <SectionTitle>Monthly Paid Sales</SectionTitle>
                  <div style={{ display: "flex", gap: 4 }}>
                    {[["6", "6M"], ["12", "12M"], ["all", "All"]].map(([val, lbl]) => (
                      <button key={val} onClick={() => setMonthRange(val)} style={{
                        padding: "5px 12px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600,
                        background: monthRange === val ? COLORS.accent : COLORS.accentLight,
                        color: monthRange === val ? "#FFFFFF" : COLORS.textMuted,
                      }}>{lbl}</button>
                    ))}
                  </div>
                </div>
                <ResponsiveContainer width="100%" height={300}>
                  <ComposedChart data={filteredMonthly}>
                    <CartesianGrid strokeDasharray="3 3" stroke={COLORS.cardBorder} />
                    <XAxis dataKey="m" tick={{ fill: COLORS.textMuted, fontSize: 11 }} interval={monthRange === "all" ? 3 : 0} angle={-45} textAnchor="end" height={60} />
                    <YAxis tick={{ fill: COLORS.textMuted, fontSize: 11 }} tickFormatter={(v) => fmt(v)} />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="revenue" radius={[4, 4, 0, 0]} name="Revenue">
                      {filteredMonthly.map((entry, i) => {
                        const year = entry.m.split(" ")[1];
                        const yearColors = { "23": "#7674B6", "24": "#16a34a", "25": "#2563eb", "26": "#ea580c" };
                        return <Cell key={i} fill={yearColors[year] || COLORS.accent} />;
                      })}
                    </Bar>
                    <Line type="monotone" dataKey="aov" stroke={COLORS.green} strokeWidth={2} dot={false} name="AOV" />
                  </ComposedChart>
                </ResponsiveContainer>
              </ChartCard>

              <ChartCard>
                <SectionTitle>Revenue Breakdown</SectionTitle>
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie data={breakdownData} cx="50%" cy="45%" innerRadius={60} outerRadius={95} dataKey="value" nameKey="name" paddingAngle={3}>
                      {breakdownData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i]} />)}
                    </Pie>
                    <Tooltip formatter={(v) => fmtFull(v)} />
                    <Legend wrapperStyle={{ fontSize: 12, color: COLORS.textMuted }} />
                  </PieChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>

            {/* Seasonality */}
            <ChartCard style={{ marginBottom: 32 }}>
              <SectionTitle>Seasonality — Average Order Value by Month</SectionTitle>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={seasonalityData}>
                  <CartesianGrid strokeDasharray="3 3" stroke={COLORS.cardBorder} />
                  <XAxis dataKey="month" tick={{ fill: COLORS.textMuted, fontSize: 12 }} />
                  <YAxis tick={{ fill: COLORS.textMuted, fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="avgRev" fill={COLORS.purple} radius={[4, 4, 0, 0]} name="Avg Order Value" />
                  <Bar dataKey="count" fill={`${COLORS.cyan}60`} radius={[4, 4, 0, 0]} name="# of Projects" />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            {/* Billing Status */}
            <ChartCard>
              <SectionTitle>Collection Status</SectionTitle>
              <div style={{ display: "flex", gap: 24, alignItems: "center", flexWrap: "wrap" }}>
                {billingData.map((b, i) => {
                  const pct = (b.revenue / 1482350 * 100).toFixed(1);
                  const colors = [COLORS.green, COLORS.red, COLORS.orange];
                  return (
                    <div key={b.status} style={{ flex: 1, minWidth: 180, textAlign: "center", padding: 16 }}>
                      <div style={{ fontSize: 28, fontWeight: 700, color: colors[i] }}>{fmtFull(b.revenue)}</div>
                      <div style={{ color: COLORS.textMuted, fontSize: 13, marginTop: 4 }}>{b.status} · {b.count} projects · {pct}%</div>
                    </div>
                  );
                })}
              </div>
              <div style={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden", marginTop: 16 }}>
                <div style={{ width: `${(1264479/1482350*100)}%`, background: COLORS.green }} />
                <div style={{ width: `${(60122/1482350*100)}%`, background: COLORS.red }} />
                <div style={{ width: `${(31698/1482350*100)}%`, background: COLORS.orange }} />
              </div>
            </ChartCard>
          </>
        )}

        {/* SALES TAB */}
        {activeTab === "Sales" && (
          <>
            <StaleNote style={{ marginBottom: 20 }}>
              {liveData ? "Sales include Contract Signed projects with billing status Paid, grouped by First Signed Date. Paid status is evaluated as of the latest export." : "Loading verified paid sales. If the source cannot be read, sales stay unavailable rather than using saved estimates."}
            </StaleNote>

            {/* Sales vs Earned Revenue KPI Cards */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 28 }}>
              <ChartCard>
                <div style={{ color: COLORS.textMuted, fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px" }}>Total Sales (Paid Contracts)</div>
                <div style={{ fontSize: 28, fontWeight: 700, color: COLORS.accent, marginTop: 6 }}>{fmtFull(totalSales2026)}</div>
                <div style={{ color: COLORS.textMuted, fontSize: 12, marginTop: 4 }}>{paidContractCount ?? "—"} paid contracts · 2026 YTD</div>
              </ChartCard>
              <ChartCard>
                <div style={{ color: COLORS.textMuted, fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px" }}>Earned Revenue</div>
                <div style={{ fontSize: 28, fontWeight: 700, color: COLORS.green, marginTop: 6 }}>{fmtFull(earnedRevenue2026.earned)}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                  <span style={{ fontSize: 12, color: COLORS.textMuted }}>{earnedRevenue2026.earnedCount} completed jobs · 2026 YTD</span>
                </div>
              </ChartCard>
              <ChartCard>
                <div style={{ color: COLORS.textMuted, fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px" }}>Unearned (Upcoming)</div>
                <div style={{ fontSize: 28, fontWeight: 700, color: COLORS.orange, marginTop: 6 }}>{fmtFull(earnedRevenue2026.unearned)}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                  <span style={{ fontSize: 12, color: COLORS.textMuted }}>{earnedRevenue2026.unearnedCount} upcoming jobs · Logistics pending</span>
                </div>
              </ChartCard>
              <ChartCard>
                <div style={{ color: COLORS.textMuted, fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px" }}>Avg Order Value</div>
                <div style={{ fontSize: 28, fontWeight: 700, color: COLORS.blue, marginTop: 6 }}>{fmtFull(paidContractCount ? totalSales2026 / paidContractCount : (totalSales2026 == null ? null : 0))}</div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 4 }}>
                  <span style={{ fontSize: 12, color: COLORS.textMuted }}>{paidContractCount ?? "—"} paid contracts · 2026 YTD</span>
                </div>
              </ChartCard>
            </div>

            {/* Sales vs Earned Revenue Chart */}
            <ChartCard style={{ marginBottom: 24 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <SectionTitle>Monthly Paid Sales</SectionTitle>
                <div style={{ display: "flex", gap: 4 }}>
                  {[["6", "6M"], ["12", "12M"], ["all", "All"]].map(([val, lbl]) => (
                    <button key={val} onClick={() => setMonthRange(val)} style={{
                      padding: "5px 12px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600,
                      background: monthRange === val ? COLORS.accent : COLORS.accentLight,
                      color: monthRange === val ? "#FFFFFF" : COLORS.textMuted,
                    }}>{lbl}</button>
                  ))}
                </div>
              </div>
              <ResponsiveContainer width="100%" height={350}>
                <ComposedChart data={filteredMonthly}>
                  <defs>
                    <linearGradient id="salesGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={COLORS.accent} stopOpacity={0.15} />
                      <stop offset="95%" stopColor={COLORS.accent} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={COLORS.cardBorder} />
                  <XAxis dataKey="m" tick={{ fill: COLORS.textMuted, fontSize: 11 }} interval={monthRange === "all" ? 3 : 0} angle={-45} textAnchor="end" height={60} />
                  <YAxis tick={{ fill: COLORS.textMuted, fontSize: 11 }} tickFormatter={(v) => fmt(v)} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="revenue" radius={[4, 4, 0, 0]} name="Total Sales">
                    {filteredMonthly.map((entry, i) => {
                      const year = entry.m.split(" ")[1];
                      const yearColors = { "23": "#7674B6", "24": "#16a34a", "25": "#2563eb", "26": "#ea580c" };
                      return <Cell key={i} fill={yearColors[year] || COLORS.accent} />;
                    })}
                  </Bar>
                  <Line type="monotone" dataKey="aov" stroke={COLORS.green} strokeWidth={2} dot={false} name="AOV" />
                </ComposedChart>
              </ResponsiveContainer>
            </ChartCard>

            {/* Top Clients + Yearly Comparison */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
              <ChartCard>
                <SectionTitle>Top 5 Clients — 2026</SectionTitle>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr style={{ borderBottom: `2px solid ${COLORS.cardBorder}` }}>
                        {["", "Client", "Spend", "Orders", "AOV"].map(h => (
                          <th key={h} style={{ textAlign: "left", padding: "10px 12px", color: COLORS.textMuted, fontWeight: 600, fontSize: 12 }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {topClients2026.map((c, i) => (
                        <tr key={c.name} style={{ borderBottom: `1px solid ${COLORS.cardBorder}` }}>
                          <td style={{ padding: "10px 12px" }}>
                            <span style={{
                              width: 24, height: 24, borderRadius: 6, display: "inline-flex", alignItems: "center", justifyContent: "center",
                              fontSize: 12, fontWeight: 700, color: "#fff", background: CHART_COLORS[i],
                            }}>{i + 1}</span>
                          </td>
                          <td style={{ padding: "10px 12px", fontWeight: 600 }}>{c.name}</td>
                          <td style={{ padding: "10px 12px", color: COLORS.accent, fontWeight: 700 }}>{fmtFull(c.spend)}</td>
                          <td style={{ padding: "10px 12px" }}>{c.orders}</td>
                          <td style={{ padding: "10px 12px", color: COLORS.green, fontWeight: 600 }}>{fmtFull(c.aov)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div style={{ fontSize: 10, color: COLORS.textMuted, marginTop: 8, fontWeight: 500 }}>Source: GSP Master Sheet · Paid contracts · First Signed Date · 2026 YTD</div>
                </div>
              </ChartCard>

              <ChartCard>
                <SectionTitle>Yearly Paid Sales Comparison</SectionTitle>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={yearCards}>
                    <CartesianGrid strokeDasharray="3 3" stroke={COLORS.cardBorder} />
                    <XAxis dataKey="year" tick={{ fill: COLORS.textMuted, fontSize: 12 }} />
                    <YAxis tick={{ fill: COLORS.textMuted, fontSize: 11 }} tickFormatter={(v) => fmt(v)} />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="revenue" name="Sales" radius={[6, 6, 0, 0]}>
                      {yearCards.map((_, i) => <Cell key={i} fill={CHART_COLORS[i]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>

            {/* Earned vs Unearned + AOV Trend */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
              <ChartCard>
                <SectionTitle>Earned vs Unearned Revenue</SectionTitle>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "20px 0" }}>
                  <ResponsiveContainer width="100%" height={240}>
                    <PieChart>
                      <Pie data={[{ name: "Earned", value: earnedRevenue2026.earned }, { name: "Unearned", value: earnedRevenue2026.unearned }]} cx="50%" cy="50%" innerRadius={65} outerRadius={95} dataKey="value" paddingAngle={4}>
                        <Cell fill={COLORS.green} />
                        <Cell fill={COLORS.orange} />
                      </Pie>
                      <Tooltip formatter={(v) => fmtFull(v)} />
                      <Legend wrapperStyle={{ fontSize: 12, color: COLORS.textMuted }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div style={{ display: "flex", justifyContent: "center", gap: 32, marginTop: 4 }}>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 20, fontWeight: 700, color: COLORS.green }}>{fmtFull(earnedRevenue2026.earned)}</div>
                    <div style={{ fontSize: 11, color: COLORS.textMuted, marginTop: 2 }}>Earned ({(totalSales2026 ? (earnedRevenue2026.earned / totalSales2026 * 100).toFixed(1) : "—")}%) · {earnedRevenue2026.earnedCount} jobs</div>
                  </div>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 20, fontWeight: 700, color: COLORS.orange }}>{fmtFull(earnedRevenue2026.unearned)}</div>
                    <div style={{ fontSize: 11, color: COLORS.textMuted, marginTop: 2 }}>Unearned ({(totalSales2026 ? (earnedRevenue2026.unearned / totalSales2026 * 100).toFixed(1) : "—")}%) · {earnedRevenue2026.unearnedCount} jobs</div>
                  </div>
                </div>
                <div style={{ fontSize: 10, color: COLORS.textMuted, marginTop: 12, textAlign: "center", fontWeight: 500 }}>Based on logistics start date from GSP</div>
              </ChartCard>

              <ChartCard>
                <SectionTitle>AOV Trend</SectionTitle>
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={filteredMonthly}>
                    <CartesianGrid strokeDasharray="3 3" stroke={COLORS.cardBorder} />
                    <XAxis dataKey="m" tick={{ fill: COLORS.textMuted, fontSize: 11 }} interval={monthRange === "all" ? 5 : 0} angle={-45} textAnchor="end" height={60} />
                    <YAxis tick={{ fill: COLORS.textMuted, fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
                    <Tooltip content={<CustomTooltip />} />
                    <Line type="monotone" dataKey="aov" stroke={COLORS.green} strokeWidth={2.5} dot={false} name="AOV" />
                  </LineChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>

            {/* 2026 Projection */}
            <ChartCard>
              <SectionTitle>2026 Sales Pipeline</SectionTitle>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 24, textAlign: "center", padding: "16px 0" }}>
                <div>
                  <div style={{ color: COLORS.textMuted, fontSize: 13 }}>Contracts Signed</div>
                  <div style={{ fontSize: 28, fontWeight: 700, color: COLORS.accent, marginTop: 4 }}>{fmtFull(totalSales2026)}</div>
                  <div style={{ color: COLORS.textMuted, fontSize: 12, marginTop: 2 }}>{paidContractCount ?? "—"} paid contracts</div>
                </div>
                <div>
                  <div style={{ color: COLORS.textMuted, fontSize: 13 }}>Quotes Sent</div>
                  <div style={{ fontSize: 28, fontWeight: 700, color: COLORS.orange, marginTop: 4 }}>{gspStatusCounts.quoteSent}</div>
                  <div style={{ color: COLORS.textMuted, fontSize: 12, marginTop: 2 }}>Awaiting signature</div>
                </div>
                <div>
                  <div style={{ color: COLORS.textMuted, fontSize: 13 }}>New Projects</div>
                  <div style={{ fontSize: 28, fontWeight: 700, color: COLORS.blue, marginTop: 4 }}>{gspStatusCounts.newProject}</div>
                  <div style={{ color: COLORS.textMuted, fontSize: 12, marginTop: 2 }}>Quote not yet sent</div>
                </div>
              </div>
              <div style={{ height: 12, background: COLORS.accentLight, borderRadius: 6, overflow: "hidden", marginTop: 8 }}>
                <div style={{
                  width: `${(gspStatusCounts.contractSigned / (gspStatusCounts.contractSigned + gspStatusCounts.quoteSent + gspStatusCounts.newProject) * 100).toFixed(1)}%`, height: "100%",
                  background: `linear-gradient(90deg, ${COLORS.accent}, ${COLORS.green})`, borderRadius: 6,
                }} />
              </div>
              <div style={{ color: COLORS.textMuted, fontSize: 12, textAlign: "center", marginTop: 8 }}>
                {(gspStatusCounts.contractSigned / (gspStatusCounts.contractSigned + gspStatusCounts.quoteSent + gspStatusCounts.newProject) * 100).toFixed(1)}% conversion rate (Contract Signed / Total Projects)
              </div>
            </ChartCard>
          </>
        )}

        {/* MARKETING TAB */}
        {activeTab === "Marketing" && (
          <>
            {/* ── Date Picker ── */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 24, flexWrap: "wrap" }}>
              {[["7d", "Last 7 Days"], ["14d", "Last 14 Days"], ["30d", "Last 30 Days"], ["custom", "Custom"]].map(([val, label]) => (
                <button key={val} onClick={() => setMktPreset(val)} style={{
                  padding: "7px 16px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600,
                  background: mktPreset === val ? COLORS.accent : COLORS.accentLight,
                  color: mktPreset === val ? "#FFFFFF" : COLORS.textMuted,
                  transition: "all 0.15s",
                }}>{label}</button>
              ))}
              {mktPreset === "custom" && (
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 4 }}>
                  <input type="date" value={mktFrom} onChange={e => setMktFrom(e.target.value)} min="2026-04-09" max="2026-05-09"
                    style={{ padding: "6px 10px", borderRadius: 6, border: `1px solid ${COLORS.cardBorder}`, fontSize: 13, color: COLORS.text, background: COLORS.cardBg }} />
                  <span style={{ color: COLORS.textMuted }}>–</span>
                  <input type="date" value={mktTo} onChange={e => setMktTo(e.target.value)} min="2026-04-09" max="2026-05-09"
                    style={{ padding: "6px 10px", borderRadius: 6, border: `1px solid ${COLORS.cardBorder}`, fontSize: 13, color: COLORS.text, background: COLORS.cardBg }} />
                </div>
              )}
              <span style={{ fontSize: 12, color: COLORS.textMuted, marginLeft: 8, fontWeight: 500 }}>
                {mkt.dateLabel} · {mkt.rangeDays} day{mkt.rangeDays !== 1 ? "s" : ""} (vs prior period)
              </span>
            </div>
            {mktStale ? (
              <StaleNote style={{ marginBottom: 24 }}>
                <strong>Marketing numbers stop at {fmtDate(mktLastDate)}</strong> ({daysOld(mktLastDate)} days ago).
                {" "}Everything below covers Windsor.ai data from {fmtDate(new Date(GA4_DAILY[0].d + "T12:00:00"))} to {fmtDate(mktLastDate)}. "Last 7/14/30 days" means the last days in that window, not this week.
              </StaleNote>
            ) : (
              <p style={{ color: COLORS.textMuted, fontSize: 11, marginTop: 8 }}>Windsor.ai data covers {GA4_DAILY[0]?.d} to {GA4_DAILY[GA4_DAILY.length - 1]?.d}</p>
            )}

            {/* ── Website Traffic KPIs ── */}
            <BrandedSection logo={<GA4Logo />} title="Website Traffic" subtitle="Google Analytics 4 · theeventrentalguys.com" borderColor="#F9AB00" />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 24 }}>
              {[
                { label: "Sessions", val: mkt.ga4.sessions, comp: mkt.ga4Prev.sessions, icon: Users, color: COLORS.purple, colorLight: COLORS.purpleLight },
                { label: "Page Views", val: mkt.ga4.pageviews, comp: mkt.ga4Prev.pageviews, icon: Activity, color: COLORS.blue, colorLight: COLORS.blueLight },
                { label: "Users", val: mkt.ga4.users, comp: mkt.ga4Prev.users, icon: Users, color: COLORS.orange, colorLight: COLORS.orangeLight },
                { label: "New Users", val: mkt.ga4.newUsers, comp: mkt.ga4Prev.newUsers, icon: Users, color: COLORS.green, colorLight: COLORS.greenLight },
              ].map(({ label, val, comp, icon: Ic, color, colorLight }) => {
                const diff = val - comp;
                const pct = comp === 0 ? (val > 0 ? 100 : 0) : Math.round(Math.abs(diff) / comp * 100);
                const isUp = diff > 0;
                return (
                  <ChartCard key={label}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <div style={{ background: colorLight, borderRadius: 8, padding: 6, display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <Ic size={14} color={color} />
                      </div>
                      <span style={{ color: COLORS.textMuted, fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px" }}>{label}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                      <span style={{ fontSize: 26, fontWeight: 700, color: COLORS.text }}>{val.toLocaleString()}</span>
                      {diff !== 0 && (
                        <span style={{ fontSize: 13, fontWeight: 600, color: isUp ? COLORS.green : COLORS.red }}>
                          {isUp ? "▲" : "▼"}{pct}%
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: COLORS.textMuted, marginTop: 2 }}>Prior: {comp.toLocaleString()}</div>
                  </ChartCard>
                );
              })}
            </div>

            {/* Daily Sessions Chart + Traffic Sources Pie */}
            <div style={{ display: "grid", gridTemplateColumns: "3fr 2fr", gap: 16, marginBottom: 24 }}>
              <ChartCard>
                <SectionTitle>Daily Sessions</SectionTitle>
                <ResponsiveContainer width="100%" height={280}>
                  <ComposedChart data={mkt.dailyChart}>
                    <CartesianGrid strokeDasharray="3 3" stroke={COLORS.cardBorder} />
                    <XAxis dataKey="label" tick={{ fill: COLORS.textMuted, fontSize: 11 }} interval={mkt.dailyChart.length > 14 ? 2 : 0} angle={mkt.dailyChart.length > 10 ? -45 : 0} textAnchor={mkt.dailyChart.length > 10 ? "end" : "middle"} height={mkt.dailyChart.length > 10 ? 50 : 30} />
                    <YAxis tick={{ fill: COLORS.textMuted, fontSize: 11 }} />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="sessions" name="Sessions" fill={COLORS.purple} radius={[4, 4, 0, 0]} barSize={mkt.dailyChart.length > 14 ? 12 : 20} />
                    <Line type="monotone" dataKey="pageviews" name="Page Views" stroke={COLORS.blue} strokeWidth={2} dot={mkt.dailyChart.length <= 14 ? { r: 3, fill: COLORS.blue } : false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </ChartCard>

              <ChartCard>
                <SectionTitle>Traffic Sources</SectionTitle>
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie data={mkt.sourcesPie} cx="50%" cy="45%" innerRadius={55} outerRadius={90} dataKey="sessions" nameKey="name" paddingAngle={3}>
                      {mkt.sourcesPie.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v) => `${v} sessions`} />
                    <Legend wrapperStyle={{ fontSize: 11, color: COLORS.textMuted }} />
                  </PieChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>

            {/* Top Pages */}
            <ChartCard style={{ marginBottom: 32 }}>
              <SectionTitle>Top Pages</SectionTitle>
              <div style={{ overflowY: "auto", maxHeight: 280 }}>
                {topPages.map((p, i) => (
                  <div key={p.page} style={{
                    display: "flex", alignItems: "center", gap: 10, padding: "8px 0",
                    borderBottom: i < topPages.length - 1 ? `1px solid ${COLORS.cardBorder}` : "none",
                  }}>
                    <span style={{
                      width: 22, height: 22, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 11, fontWeight: 700, color: "#fff", background: CHART_COLORS[i % CHART_COLORS.length], flexShrink: 0,
                    }}>{i + 1}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: COLORS.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.page}</div>
                    </div>
                    <span style={{ fontSize: 13, fontWeight: 700, color: COLORS.accent, flexShrink: 0 }}>{p.views}</span>
                    <span style={{ fontSize: 11, color: COLORS.textMuted, flexShrink: 0, width: 36, textAlign: "right" }}>{p.pct}%</span>
                  </div>
                ))}
              </div>
            </ChartCard>

            {/* ── Google Ads ── */}
            <div style={{ paddingTop: 24 }}>
              <BrandedSection logo={<GoogleAdsLogo />} title="Google Ads" subtitle="Account 956-015-9568 · Event Rental Guys" borderColor="#4285F4" />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 24 }}>
              {[
                { label: "Ad Spend", val: mkt.ads.spend, comp: mkt.adsPrev.spend, isCurr: true, color: COLORS.red, colorLight: COLORS.redLight, icon: DollarSign },
                { label: "Clicks", val: mkt.ads.clicks, comp: mkt.adsPrev.clicks, isCurr: false, color: COLORS.blue, colorLight: COLORS.blueLight, icon: Activity },
                { label: "Conversions", val: mkt.ads.conversions, comp: mkt.adsPrev.conversions, isCurr: false, color: COLORS.green, colorLight: COLORS.greenLight, icon: TrendingUp },
                { label: "CPC", val: mkt.adsCPC, comp: mkt.adsPrevCPC, isCurr: true, color: COLORS.orange, colorLight: COLORS.orangeLight, icon: DollarSign, invertColor: true },
              ].map(({ label, val, comp, isCurr, color, colorLight, icon: Ic, invertColor }) => {
                const diff = val - comp;
                const pct = comp === 0 ? (val > 0 ? 100 : 0) : Math.round(Math.abs(diff) / comp * 100);
                const isUp = diff > 0;
                const arrowColor = invertColor ? (isUp ? COLORS.red : COLORS.green) : (isUp ? COLORS.green : COLORS.red);
                return (
                  <ChartCard key={label}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <div style={{ background: colorLight, borderRadius: 8, padding: 6, display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <Ic size={14} color={color} />
                      </div>
                      <span style={{ color: COLORS.textMuted, fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px" }}>{label}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                      <span style={{ fontSize: 26, fontWeight: 700, color: COLORS.text }}>{isCurr ? `$${val.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : val.toLocaleString()}</span>
                      {diff !== 0 && (
                        <span style={{ fontSize: 13, fontWeight: 600, color: arrowColor }}>
                          {isUp ? "▲" : "▼"}{pct}%
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: COLORS.textMuted, marginTop: 2 }}>Prior: {isCurr ? `$${comp.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : comp.toLocaleString()}</div>
                  </ChartCard>
                );
              })}
            </div>

            {/* Campaign Performance Table */}
            <ChartCard style={{ marginBottom: 32 }}>
              <SectionTitle>Campaign Performance</SectionTitle>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: `2px solid ${COLORS.cardBorder}` }}>
                      {["Campaign", "Spend", "Clicks", "Impressions", "CTR", "Conversions", "CPC"].map(h => (
                        <th key={h} style={{ textAlign: "left", padding: "10px 14px", color: COLORS.textMuted, fontWeight: 600, fontSize: 12 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {campaignData.map((c) => (
                      <tr key={c.campaign} style={{ borderBottom: `1px solid ${COLORS.cardBorder}` }}>
                        <td style={{ padding: "10px 14px", fontWeight: 600 }}>{c.campaign}</td>
                        <td style={{ padding: "10px 14px", color: COLORS.red, fontWeight: 600 }}>{fmtFull(c.spend)}</td>
                        <td style={{ padding: "10px 14px" }}>{c.clicks}</td>
                        <td style={{ padding: "10px 14px" }}>{c.impressions.toLocaleString()}</td>
                        <td style={{ padding: "10px 14px" }}>{c.ctr}%</td>
                        <td style={{ padding: "10px 14px", color: COLORS.green, fontWeight: 600 }}>{c.conversions}</td>
                        <td style={{ padding: "10px 14px" }}>${c.cpc.toFixed(2)}</td>
                      </tr>
                    ))}
                    <tr style={{ borderTop: `2px solid ${COLORS.cardBorder}`, background: COLORS.bg }}>
                      <td style={{ padding: "10px 14px", fontWeight: 700 }}>Total</td>
                      <td style={{ padding: "10px 14px", fontWeight: 700, color: COLORS.red }}>{fmtFull(campaignData.reduce((s, c) => s + c.spend, 0))}</td>
                      <td style={{ padding: "10px 14px", fontWeight: 700 }}>{campaignData.reduce((s, c) => s + c.clicks, 0)}</td>
                      <td style={{ padding: "10px 14px", fontWeight: 700 }}>{campaignData.reduce((s, c) => s + c.impressions, 0).toLocaleString()}</td>
                      <td style={{ padding: "10px 14px", fontWeight: 700 }}>{(campaignData.reduce((s, c) => s + c.clicks, 0) / campaignData.reduce((s, c) => s + c.impressions, 0) * 100).toFixed(2)}%</td>
                      <td style={{ padding: "10px 14px", fontWeight: 700, color: COLORS.green }}>{campaignData.reduce((s, c) => s + c.conversions, 0)}</td>
                      <td style={{ padding: "10px 14px", fontWeight: 700 }}>${(campaignData.reduce((s, c) => s + c.spend, 0) / campaignData.reduce((s, c) => s + c.clicks, 0)).toFixed(2)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </ChartCard>

            {/* ── Search Console ── */}
            <div style={{ paddingTop: 24 }}>
              <BrandedSection logo={<SearchConsoleLogo />} title="Google Search Console" subtitle="theeventrentalguys.com · Data has a 2-day delay" borderColor="#4285F4" />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 24 }}>
              {[
                { label: "Organic Clicks", val: mkt.sc.clicks, comp: mkt.scPrev.clicks, color: COLORS.green, colorLight: COLORS.greenLight, icon: Activity },
                { label: "Impressions", val: mkt.sc.impressions, comp: mkt.scPrev.impressions, color: COLORS.blue, colorLight: COLORS.blueLight, icon: BarChart3 },
                { label: "CTR", val: mkt.sc.ctr, comp: mkt.scPrev.ctr, color: COLORS.purple, colorLight: COLORS.purpleLight, icon: TrendingUp, isPct: true },
                { label: "Avg Position", val: mkt.sc.position, comp: mkt.scPrev.position, color: COLORS.orange, colorLight: COLORS.orangeLight, icon: MapPin, invertColor: true, isDecimal: true },
              ].map(({ label, val, comp, color, colorLight, icon: Ic, invertColor, isPct, isDecimal }) => {
                const diff = val - comp;
                const pct = comp === 0 ? (val > 0 ? 100 : 0) : Math.round(Math.abs(diff) / comp * 100);
                const isUp = diff > 0;
                const arrowColor = invertColor ? (isUp ? COLORS.red : COLORS.green) : (isUp ? COLORS.green : COLORS.red);
                return (
                  <ChartCard key={label}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <div style={{ background: colorLight, borderRadius: 8, padding: 6, display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <Ic size={14} color={color} />
                      </div>
                      <span style={{ color: COLORS.textMuted, fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px" }}>{label}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                      <span style={{ fontSize: 26, fontWeight: 700, color: COLORS.text }}>{isPct ? `${val}%` : isDecimal ? val.toFixed(1) : val.toLocaleString()}</span>
                      {diff !== 0 && (
                        <span style={{ fontSize: 13, fontWeight: 600, color: arrowColor }}>
                          {isUp ? "▲" : "▼"}{pct}%
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: COLORS.textMuted, marginTop: 2 }}>Prior: {isPct ? `${comp}%` : isDecimal ? comp.toFixed(1) : comp.toLocaleString()}</div>
                  </ChartCard>
                );
              })}
            </div>

            {/* Top Search Queries */}
            <ChartCard>
              <SectionTitle>Top Search Queries</SectionTitle>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: `2px solid ${COLORS.cardBorder}` }}>
                      {["#", "Query", "Clicks", "Impressions", "CTR", "Avg Position"].map(h => (
                        <th key={h} style={{ textAlign: "left", padding: "10px 14px", color: COLORS.textMuted, fontWeight: 600, fontSize: 12 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {topQueries.map((q, i) => (
                      <tr key={q.query} style={{ borderBottom: `1px solid ${COLORS.cardBorder}` }}>
                        <td style={{ padding: "10px 14px" }}>
                          <span style={{
                            width: 22, height: 22, borderRadius: 6, display: "inline-flex", alignItems: "center", justifyContent: "center",
                            fontSize: 11, fontWeight: 700, color: "#fff", background: CHART_COLORS[i % CHART_COLORS.length],
                          }}>{i + 1}</span>
                        </td>
                        <td style={{ padding: "10px 14px", fontWeight: 600 }}>{q.query}</td>
                        <td style={{ padding: "10px 14px", color: COLORS.green, fontWeight: 600 }}>{q.clicks}</td>
                        <td style={{ padding: "10px 14px" }}>{q.impressions}</td>
                        <td style={{ padding: "10px 14px" }}>{q.ctr}%</td>
                        <td style={{ padding: "10px 14px" }}>
                          <span style={{
                            background: q.position <= 5 ? COLORS.greenLight : q.position <= 10 ? COLORS.orangeLight : COLORS.redLight,
                            color: q.position <= 5 ? COLORS.green : q.position <= 10 ? COLORS.orange : COLORS.red,
                            padding: "3px 8px", borderRadius: 4, fontWeight: 600, fontSize: 12,
                          }}>{q.position.toFixed(1)}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </ChartCard>
          </>
        )}

        {/* GEOGRAPHY TAB */}
        {activeTab === "Geography" && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
              <ChartCard>
                <SectionTitle>Revenue by County</SectionTitle>
                <ResponsiveContainer width="100%" height={400}>
                  <BarChart data={countyData} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke={COLORS.cardBorder} />
                    <XAxis type="number" tick={{ fill: COLORS.textMuted, fontSize: 11 }} tickFormatter={(v) => fmt(v)} />
                    <YAxis type="category" dataKey="county" width={90} tick={{ fill: COLORS.textMuted, fontSize: 12 }} />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="revenue" name="Revenue" radius={[0, 6, 6, 0]}>
                      {countyData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>

              <ChartCard>
                <SectionTitle>Revenue by City</SectionTitle>
                <ResponsiveContainer width="100%" height={400}>
                  <BarChart data={cityData} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke={COLORS.cardBorder} />
                    <XAxis type="number" tick={{ fill: COLORS.textMuted, fontSize: 11 }} tickFormatter={(v) => fmt(v)} />
                    <YAxis type="category" dataKey="city" width={120} tick={{ fill: COLORS.textMuted, fontSize: 11 }} />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="revenue" name="Revenue" fill={COLORS.accent} radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>

            {/* City Detail Table */}
            <ChartCard>
              <SectionTitle>City Performance Detail</SectionTitle>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: `2px solid ${COLORS.cardBorder}` }}>
                      {["City", "Revenue", "Projects", "AOV", "Revenue Share"].map(h => (
                        <th key={h} style={{ textAlign: "left", padding: "10px 14px", color: COLORS.textMuted, fontWeight: 600, fontSize: 12 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {cityData.map((c, i) => (
                      <tr key={c.city} style={{ borderBottom: `1px solid ${COLORS.cardBorder}` }}>
                        <td style={{ padding: "10px 14px", fontWeight: 600 }}>{c.city}</td>
                        <td style={{ padding: "10px 14px", color: COLORS.accent, fontWeight: 600 }}>{fmtFull(c.revenue)}</td>
                        <td style={{ padding: "10px 14px" }}>{c.count}</td>
                        <td style={{ padding: "10px 14px", color: COLORS.green, fontWeight: 600 }}>{fmtFull(c.aov)}</td>
                        <td style={{ padding: "10px 14px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <div style={{ flex: 1, height: 6, background: COLORS.accentLight, borderRadius: 3 }}>
                              <div style={{ width: `${(c.revenue / 144151 * 100)}%`, height: "100%", background: CHART_COLORS[i % CHART_COLORS.length], borderRadius: 3 }} />
                            </div>
                            <span style={{ color: COLORS.textMuted, fontSize: 11, minWidth: 36 }}>{(c.revenue / 1482350 * 100).toFixed(1)}%</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </ChartCard>
          </>
        )}

        {/* TEAM TAB */}
        {activeTab === "Team" && (
          <>
            <ChartCard style={{ marginBottom: 24 }}>
              <SectionTitle>Sales Lead Performance</SectionTitle>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={salesData}>
                  <CartesianGrid strokeDasharray="3 3" stroke={COLORS.cardBorder} />
                  <XAxis dataKey="lead" tick={{ fill: COLORS.textMuted, fontSize: 11 }} angle={-15} textAnchor="end" height={50} />
                  <YAxis tick={{ fill: COLORS.textMuted, fontSize: 11 }} tickFormatter={(v) => fmt(v)} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="revenue" name="Revenue" fill={COLORS.accent} radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard>
              <SectionTitle>Team Detail</SectionTitle>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: `2px solid ${COLORS.cardBorder}` }}>
                      {["Sales Lead", "Revenue", "Projects", "AOV", "Revenue Share"].map(h => (
                        <th key={h} style={{ textAlign: "left", padding: "12px 14px", color: COLORS.textMuted, fontWeight: 600, fontSize: 12 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {salesData.map((s, i) => (
                      <tr key={s.lead} style={{ borderBottom: `1px solid ${COLORS.cardBorder}` }}>
                        <td style={{ padding: "12px 14px", fontWeight: 600 }}>{s.lead}</td>
                        <td style={{ padding: "12px 14px", color: COLORS.accent, fontWeight: 600 }}>{fmtFull(s.revenue)}</td>
                        <td style={{ padding: "12px 14px" }}>{s.count}</td>
                        <td style={{ padding: "12px 14px", color: COLORS.green, fontWeight: 600 }}>{fmtFull(s.aov)}</td>
                        <td style={{ padding: "12px 14px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <div style={{ flex: 1, height: 6, background: COLORS.accentLight, borderRadius: 3 }}>
                              <div style={{ width: `${(s.revenue / 1393784 * 100)}%`, height: "100%", background: CHART_COLORS[i], borderRadius: 3 }} />
                            </div>
                            <span style={{ color: COLORS.textMuted, fontSize: 11, minWidth: 36 }}>{(s.revenue / 1482350 * 100).toFixed(1)}%</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </ChartCard>
          </>
        )}

        {/* Footer */}
        <div style={{
          textAlign: "center", color: COLORS.textMuted, fontSize: 11, marginTop: 40, paddingTop: 20,
          borderTop: `1px solid ${COLORS.cardBorder}`,
        }}>
          The Event Rental Guys · Business Dashboard · Data: Goodshuffle Pro (Jan 2023 – {exportDate ? fmtDate(exportDate) : "Apr 2026"}) · Windsor.ai — GA4, Google Ads, Search Console (through {fmtDate(mktLastDate)})
        </div>
      </div>
    </div>
  );
}
