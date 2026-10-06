// 통합과학2 그림(도식). 각 그림은 SVG 문자열과 설명(cap)으로 이루어진다.
// 수치가 들어간 그림은 실제 비율(지질 시대) 또는 개념을 보여 주는 단순화한 모형이다.

const T = (x, y, text, o = {}) =>
  `<text x="${x}" y="${y}" font-size="${o.size || 13}" fill="${o.fill || "#1d1d1f"}" text-anchor="${o.anchor || "middle"}"${o.weight ? ` font-weight="${o.weight}"` : ""}>${text}</text>`;
const arrowDefs = (id, color) =>
  `<defs><marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="${color}"/></marker></defs>`;
const svg = (w, h, label, body) =>
  `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${label}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;

// ---------- 지질 시대: 실제 길이 비율 ----------
// 46억 년 = 640px. 선캄브리아 46억~5.4억(88%), 고생대 5.4억~2.5억, 중생대 2.5억~0.66억, 신생대 0.66억~현재
const geo = (() => {
  const W = 640;
  const x0 = 20;
  const total = 4600;
  const px = (ma) => x0 + ((total - ma) / total) * W;
  const eras = [
    ["선캄브리아 시대", 4600, 540, "#b9a6d9"],
    ["고생대", 540, 252, "#7fb7e8"],
    ["중생대", 252, 66, "#8fd19e"],
    ["신생대", 66, 0, "#f5c26b"],
  ];
  const bar1 = eras.map(([, a, b, c]) => `<rect x="${px(a)}" y="40" width="${px(b) - px(a)}" height="34" fill="${c}"/>`).join("");
  // 아래 확대: 5.4억 년 = 640px
  const zx = (ma) => x0 + ((540 - ma) / 540) * W;
  const bar2 = eras
    .slice(1)
    .map(([n, a, b, c]) => `<rect x="${zx(a)}" y="150" width="${zx(b) - zx(a)}" height="34" fill="${c}"/>${T((zx(a) + zx(b)) / 2, 172, n, { weight: 700 })}`)
    .join("");
  return svg(
    680,
    260,
    "지질 시대의 상대적 길이",
    `${bar1}
    ${T(px(4600) + 280, 62, "선캄브리아 시대 (약 88%)", { weight: 700 })}
    ${T(x0, 30, "약 46억 년 전", { anchor: "start", size: 12, fill: "#6e6e73" })}
    ${T(x0 + W, 30, "현재", { anchor: "end", size: 12, fill: "#6e6e73" })}
    <path d="M${px(540)} 76 L${x0} 140 M${x0 + W} 76 L${x0 + W} 140" stroke="#86868b" stroke-dasharray="4 3" fill="none"/>
    ${T(px(540), 30, "약 5.4억 년 전", { anchor: "end", size: 12, fill: "#6e6e73" })}
    ${bar2}
    ${T(zx(540), 202, "5.4억", { anchor: "start", size: 12, fill: "#6e6e73" })}
    ${T(zx(252), 202, "2.5억", { size: 12, fill: "#6e6e73" })}
    ${T(zx(66), 202, "6600만", { size: 12, fill: "#6e6e73" })}
    ${T(zx(0), 202, "현재", { anchor: "end", size: 12, fill: "#6e6e73" })}
    ${T((zx(540) + zx(252)) / 2, 230, "삼엽충 · 필석 · 어류 · 양치식물", { size: 12 })}
    ${T((zx(252) + zx(66)) / 2, 230, "공룡 · 암모나이트 · 겉씨식물", { size: 12 })}
    ${T(zx(33), 250, "포유류 · 화폐석 · 속씨식물", { size: 12, anchor: "end" })}`,
  );
})();

// ---------- 자연선택 ----------
const selection = (() => {
  const steps = ["과잉 생산", "변이", "생존 경쟁", "자연선택", "유전·진화"];
  const boxes = steps
    .map((s, i) => {
      const x = 14 + i * 132;
      return `<rect x="${x}" y="20" width="112" height="44" rx="12" fill="#e8f5ec" stroke="#1d7f45"/>${T(x + 56, 47, `${i + 1}. ${s}`, { weight: 700 })}${i < 4 ? `<path d="M${x + 114} 42 H${x + 130}" stroke="#1d7f45" stroke-width="2" marker-end="url(#ar1)"/>` : ""}`;
    })
    .join("");
  // 세대에 따라 환경에 유리한 형질(진한 점)의 비율이 늘어난다
  const gen = (y, dark, label) => {
    let dots = "";
    for (let i = 0; i < 20; i++) dots += `<circle cx="${180 + i * 22}" cy="${y}" r="8" fill="${i < dark ? "#1d7f45" : "#c7e5d0"}"/>`;
    return `${T(150, y + 5, label, { anchor: "end", size: 12 })}${dots}`;
  };
  return svg(
    680,
    210,
    "자연선택에 의한 진화 과정",
    `${arrowDefs("ar1", "#1d7f45")}${boxes}
    ${gen(100, 4, "1세대")}${gen(135, 9, "몇 세대 뒤")}${gen(170, 16, "여러 세대 뒤")}
    ${T(400, 200, "● 환경에 유리한 형질을 가진 개체의 비율이 세대를 거치며 늘어난다", { size: 12, fill: "#1d7f45" })}`,
  );
})();

// ---------- 산화 환원 ----------
const redox = svg(
  680,
  200,
  "산화 구리(Ⅱ)와 탄소의 산화 환원 반응",
  `${arrowDefs("ar2", "#c23b1d")}${arrowDefs("ar3", "#0062c4")}
  ${T(110, 110, "2CuO", { size: 22, weight: 700 })}${T(185, 110, "+", { size: 22 })}${T(240, 110, "C", { size: 22, weight: 700 })}
  ${T(330, 110, "→", { size: 24 })}
  ${T(430, 110, "2Cu", { size: 22, weight: 700 })}${T(505, 110, "+", { size: 22 })}${T(580, 110, "CO₂", { size: 22, weight: 700 })}
  <path d="M110 80 C 200 20, 340 20, 425 80" fill="none" stroke="#0062c4" stroke-width="2.5" marker-end="url(#ar3)"/>
  ${T(270, 36, "산소를 잃음 → 환원", { fill: "#0062c4", weight: 700 })}
  <path d="M240 128 C 330 190, 480 190, 575 128" fill="none" stroke="#c23b1d" stroke-width="2.5" marker-end="url(#ar2)"/>
  ${T(410, 188, "산소를 얻음 → 산화", { fill: "#c23b1d", weight: 700 })}`,
);

// ---------- pH ----------
const ph = (() => {
  const x0 = 30;
  const W = 620;
  const at = (v) => x0 + (v / 14) * W;
  let ticks = "";
  for (let v = 0; v <= 14; v++) ticks += `<path d="M${at(v)} 84 V92" stroke="#1d1d1f"/>${T(at(v), 108, v, { size: 12 })}`;
  const mark = (v, name, up) =>
    `<path d="M${at(v)} ${up ? 40 : 120} V${up ? 54 : 112}" stroke="#6e6e73"/>${T(at(v), up ? 34 : 136, name, { size: 12 })}`;
  return svg(
    680,
    170,
    "pH 척도",
    `<defs><linearGradient id="phg" x1="0" x2="1"><stop offset="0" stop-color="#e5484d"/><stop offset="0.3" stop-color="#f5a524"/><stop offset="0.5" stop-color="#3fb950"/><stop offset="0.75" stop-color="#2f81f7"/><stop offset="1" stop-color="#8250df"/></linearGradient></defs>
    <rect x="${x0}" y="56" width="${W}" height="28" rx="6" fill="url(#phg)"/>
    ${ticks}
    ${mark(1.5, "위액", true)}${mark(3, "식초", true)}${mark(7, "순수한 물(중성)", true)}${mark(10, "비누", true)}${mark(13, "하수구 세정제", true)}
    ${mark(2.3, "레몬즙", false)}${mark(7.4, "혈액(약 7.4)", false)}
    ${T(at(3.5), 160, "← 산성 (H⁺ 많음)", { fill: "#c23b1d", weight: 700 })}${T(at(10.5), 160, "염기성 (OH⁻ 많음) →", { fill: "#0062c4", weight: 700 })}`,
  );
})();

// ---------- 중화 반응: 묽은 염산에 수산화 나트륨 수용액을 넣을 때 이온 수 ----------
const neutral = (() => {
  const X = (t) => 70 + t * 260; // t: 0~2 (1 = 중화점)
  const Y = (n) => 200 - n * 70; // n: 0~2 (1 = 처음 H⁺ 수)
  const line = (pts, c, dash) =>
    `<polyline points="${pts.map(([t, n]) => `${X(t)},${Y(n)}`).join(" ")}" fill="none" stroke="${c}" stroke-width="3"${dash ? ' stroke-dasharray="6 4"' : ""}/>`;
  return svg(
    680,
    250,
    "중화 반응에서 이온 수의 변화",
    `<path d="M70 200 H620 M70 200 V40" stroke="#1d1d1f" stroke-width="1.5" fill="none"/>
    <path d="M${X(1)} 200 V40" stroke="#86868b" stroke-dasharray="4 3"/>
    ${T(X(1), 32, "중화점", { size: 12, weight: 700 })}
    ${line([[0, 1], [1, 0], [2, 0]], "#c23b1d")}
    ${line([[0, 1], [2, 1]], "#6e6e73", true)}
    ${line([[0, 0], [2, 2]], "#7a3fb0")}
    ${line([[0, 0], [1, 0], [2, 1]], "#0062c4")}
    ${T(X(0.45), Y(0.62), "H⁺", { fill: "#c23b1d", weight: 700 })}
    ${T(X(1.75), Y(1) - 8, "Cl⁻ (일정)", { fill: "#6e6e73", weight: 700 })}
    ${T(X(1.6), Y(1.75), "Na⁺", { fill: "#7a3fb0", weight: 700 })}
    ${T(X(1.75), Y(0.55), "OH⁻", { fill: "#0062c4", weight: 700 })}
    ${T(345, 232, "넣은 수산화 나트륨 수용액의 부피 →", { size: 12 })}
    ${T(40, 120, "이온 수", { size: 12 })}`,
  );
})();

// ---------- 생태계 구성 요소 ----------
const ecosystem = svg(
  680,
  230,
  "생태계 구성 요소의 관계",
  `${arrowDefs("ar4", "#1d7f45")}${arrowDefs("ar5", "#0062c4")}
  <rect x="20" y="20" width="400" height="120" rx="16" fill="#e8f5ec" stroke="#1d7f45"/>
  ${T(220, 42, "생물적 요인", { weight: 700, fill: "#1d7f45" })}
  <rect x="40" y="60" width="100" height="50" rx="10" fill="#fff" stroke="#1d7f45"/>${T(90, 90, "생산자")}
  <rect x="170" y="60" width="100" height="50" rx="10" fill="#fff" stroke="#1d7f45"/>${T(220, 90, "소비자")}
  <rect x="300" y="60" width="100" height="50" rx="10" fill="#fff" stroke="#1d7f45"/>${T(350, 90, "분해자")}
  <path d="M142 85 H166" stroke="#1d7f45" stroke-width="2" marker-end="url(#ar4)"/>
  <path d="M272 85 H296" stroke="#1d7f45" stroke-width="2" marker-end="url(#ar4)"/>
  ${T(220, 130, "생물끼리 서로 영향(상호 작용)", { size: 12, fill: "#1d7f45" })}
  <rect x="480" y="20" width="180" height="120" rx="16" fill="#e5f0fb" stroke="#0062c4"/>
  ${T(570, 42, "비생물적 요인", { weight: 700, fill: "#0062c4" })}
  ${T(570, 80, "빛 · 온도 · 물", { size: 13 })}${T(570, 104, "공기 · 토양", { size: 13 })}
  <path d="M478 60 H424" stroke="#0062c4" stroke-width="2" marker-end="url(#ar5)"/>
  ${T(450, 52, "작용", { size: 12, fill: "#0062c4" })}
  <path d="M424 112 H478" stroke="#1d7f45" stroke-width="2" marker-end="url(#ar4)"/>
  ${T(450, 130, "반작용", { size: 12, fill: "#1d7f45" })}
  ${T(340, 180, "작용: 비생물적 요인 → 생물 (예: 빛의 세기에 따라 잎의 두께가 달라짐)", { size: 12 })}
  ${T(340, 205, "반작용: 생물 → 비생물적 요인 (예: 광합성으로 대기 중 산소가 늘어남)", { size: 12 })}`,
);

// ---------- 생태 피라미드 ----------
const pyramid = (() => {
  const levels = [
    ["3차 소비자", "#f5c26b"],
    ["2차 소비자", "#f0a868"],
    ["1차 소비자", "#9fd3a8"],
    ["생산자", "#5fb878"],
  ];
  const h = 40;
  const body = levels
    .map(([name, c], i) => {
      const top = 30 + i * h;
      const half = 50 + i * 60;
      return `<rect x="${280 - half}" y="${top}" width="${half * 2}" height="${h - 4}" rx="6" fill="${c}"/>${T(280, top + 24, name, { weight: 700 })}`;
    })
    .join("");
  return svg(
    680,
    220,
    "생태 피라미드",
    `${arrowDefs("ar6", "#c23b1d")}${body}
    <path d="M560 180 V40" stroke="#c23b1d" stroke-width="2.5" marker-end="url(#ar6)"/>
    ${T(575, 70, "상위 단계로", { anchor: "start", size: 12, fill: "#c23b1d" })}
    ${T(575, 90, "갈수록 에너지양", { anchor: "start", size: 12, fill: "#c23b1d" })}
    ${T(575, 110, "개체 수·생물량", { anchor: "start", size: 12, fill: "#c23b1d" })}
    ${T(575, 130, "감소", { anchor: "start", size: 12, fill: "#c23b1d", weight: 700 })}
    ${T(280, 205, "각 단계에서 에너지 일부가 생명 활동과 열로 빠져나간다", { size: 12 })}`,
  );
})();

// ---------- 온실 효과 ----------
const greenhouse = svg(
  680,
  250,
  "온실 효과",
  `${arrowDefs("ar7", "#e0a100")}${arrowDefs("ar8", "#c23b1d")}
  <circle cx="60" cy="50" r="30" fill="#ffd60a"/>${T(60, 100, "태양", { size: 12 })}
  <rect x="0" y="200" width="680" height="50" fill="#b7d9a8"/>${T(80, 232, "지표", { weight: 700 })}
  <rect x="0" y="110" width="680" height="34" fill="#cfe3f7"/>${T(130, 132, "온실 기체 (CO₂, CH₄, H₂O …)", { size: 12 })}
  <path d="M95 75 L245 196" stroke="#e0a100" stroke-width="4" marker-end="url(#ar7)"/>${T(150, 70, "태양 복사 에너지", { size: 12, anchor: "start" })}
  <path d="M400 198 V148" stroke="#c23b1d" stroke-width="3" marker-end="url(#ar8)"/>${T(392, 182, "① 지표가 적외선 방출", { size: 12, anchor: "end", fill: "#c23b1d" })}
  <path d="M440 108 V48" stroke="#c23b1d" stroke-width="3" marker-end="url(#ar8)"/>${T(448, 60, "② 일부는 우주로", { size: 12, anchor: "start", fill: "#c23b1d" })}
  <path d="M520 146 V196" stroke="#c23b1d" stroke-width="3" marker-end="url(#ar8)"/>${T(528, 160, "③ 온실 기체가 흡수했다가", { size: 12, anchor: "start", fill: "#c23b1d" })}${T(528, 176, "다시 지표로 방출", { size: 12, anchor: "start", fill: "#c23b1d" })}
  ${T(560, 30, "→ 지표가 따뜻하게 유지됨", { size: 13, weight: 700 })}`,
);

// ---------- 엘니뇨 ----------
const elnino = (() => {
  const panel = (ox, title, warmEnd, upwell, rainX) => `
    ${T(ox + 160, 22, title, { weight: 700 })}
    <rect x="${ox}" y="80" width="320" height="110" fill="#bcd9f2"/>
    <path d="M${ox} 80 H${ox + warmEnd} Q ${ox + warmEnd + 30} 80 ${ox + warmEnd + 40} 80 L ${ox} 80 Z" fill="none"/>
    <path d="M${ox} 80 L${ox + warmEnd} 80 L${ox + warmEnd - 20} ${upwell ? 120 : 110} L${ox} 140 Z" fill="#f5a46b"/>
    ${upwell ? `<path d="M${ox + 290} 180 V92" stroke="#0062c4" stroke-width="3" marker-end="url(#ar9)"/>${T(ox + 270, 176, "용승", { size: 12, anchor: "end", fill: "#0062c4", weight: 700 })}` : `<path d="M${ox + 290} 180 V150" stroke="#0062c4" stroke-width="2" stroke-dasharray="4 3"/>${T(ox + 280, 176, "용승 약함", { size: 12, anchor: "end", fill: "#0062c4" })}`}
    <ellipse cx="${ox + rainX}" cy="40" rx="36" ry="12" fill="#9aa0a6"/>
    <path d="M${ox + rainX - 18} 54 v8 M${ox + rainX} 54 v8 M${ox + rainX + 18} 54 v8" stroke="#0062c4" stroke-width="2"/>
    <path d="M${ox + 300} 72 H${ox + 40}" stroke="#1d1d1f" stroke-width="${upwell ? 3 : 1.5}" marker-end="url(#ar10)"/>${T(ox + 305, 64, upwell ? "무역풍" : "무역풍 약화", { size: 12, anchor: "end" })}
    ${T(ox + 30, 208, "서태평양", { size: 12 })}${T(ox + 290, 208, "동태평양", { size: 12 })}
    ${T(ox + 40, 130, "따뜻한 물", { size: 11, anchor: "start" })}`;
  return svg(
    680,
    220,
    "평상시와 엘니뇨 시기의 태평양 적도 부근",
    `${arrowDefs("ar9", "#0062c4")}${arrowDefs("ar10", "#1d1d1f")}
    ${panel(10, "평상시", 170, true, 60)}
    ${panel(350, "엘니뇨 시기", 300, false, 180)}`,
  );
})();

// ---------- 지구의 에너지원 ----------
const earthenergy = svg(
  680,
  230,
  "지구의 에너지원과 전환",
  `${arrowDefs("ar11", "#6e6e73")}
  <rect x="20" y="20" width="150" height="56" rx="12" fill="#fff3c4" stroke="#e0a100"/>${T(95, 54, "태양 에너지", { weight: 700 })}
  <rect x="20" y="96" width="150" height="56" rx="12" fill="#fde2d8" stroke="#c23b1d"/>${T(95, 130, "지구 내부 에너지", { weight: 700 })}
  <rect x="20" y="172" width="150" height="50" rx="12" fill="#e5f0fb" stroke="#0062c4"/>${T(95, 203, "조력 에너지", { weight: 700 })}
  <path d="M172 40 H230" stroke="#6e6e73" stroke-width="2" marker-end="url(#ar11)"/>${T(240, 45, "광합성 → 화학 에너지 → (오랜 시간) 화석 연료", { anchor: "start", size: 12 })}
  <path d="M172 58 H230" stroke="#6e6e73" stroke-width="2" marker-end="url(#ar11)"/>${T(240, 70, "대기·물의 순환 → 바람(풍력), 비·하천(수력), 해류", { anchor: "start", size: 12 })}
  <path d="M172 124 H230" stroke="#6e6e73" stroke-width="2" marker-end="url(#ar11)"/>${T(240, 129, "지열, 화산 활동, 판의 운동", { anchor: "start", size: 12 })}
  <path d="M172 197 H230" stroke="#6e6e73" stroke-width="2" marker-end="url(#ar11)"/>${T(240, 202, "달·태양의 인력 → 밀물과 썰물(조력 발전)", { anchor: "start", size: 12 })}`,
);

// ---------- 발전기와 발전소 ----------
const generator = (() => {
  const chain = (y, label, items, color) =>
    `${T(20, y + 22, label, { anchor: "start", weight: 700 })}` +
    items
      .map((it, i) => {
        const x = 120 + i * 140;
        return `<rect x="${x}" y="${y}" width="120" height="34" rx="8" fill="${color}"/>${T(x + 60, y + 22, it, { size: 12 })}${i < items.length - 1 ? `<path d="M${x + 122} ${y + 17} H${x + 138}" stroke="#6e6e73" stroke-width="2" marker-end="url(#ar12)"/>` : ""}`;
      })
      .join("");
  return svg(
    680,
    250,
    "발전소의 에너지 전환",
    `${arrowDefs("ar12", "#6e6e73")}
    ${T(340, 24, "터빈이 발전기를 돌리면 전자기 유도로 전기가 만들어진다", { size: 13 })}
    ${chain(44, "화력", ["화학 에너지", "열에너지", "운동 에너지", "전기 에너지"], "#fde2d8")}
    ${chain(94, "핵발전", ["핵에너지", "열에너지", "운동 에너지", "전기 에너지"], "#efe3fb")}
    ${chain(144, "수력", ["위치 에너지", "운동 에너지", "전기 에너지"], "#e5f0fb")}
    ${chain(194, "풍력", ["운동 에너지(바람)", "운동 에너지(날개)", "전기 에너지"], "#e8f5ec")}`,
  );
})();

// ---------- 에너지 효율 (예시) ----------
const efficiency = svg(
  680,
  170,
  "에너지 효율 예시",
  `<rect x="30" y="40" width="600" height="40" rx="8" fill="#e8e8ed"/>
  <rect x="30" y="40" width="240" height="40" rx="8" fill="#1d7f45"/>
  ${T(150, 66, "유용하게 쓰인 에너지 40 J", { fill: "#fff", weight: 700 })}
  ${T(450, 66, "버려진 에너지(주로 열) 60 J", { weight: 700 })}
  ${T(330, 28, "공급한 에너지 100 J (예시)", { size: 12 })}
  ${T(340, 120, "에너지 효율 = 40 J ÷ 100 J × 100 = 40%", { size: 16, weight: 700 })}
  ${T(340, 150, "에너지가 전환될 때 일부는 열 등으로 빠져나가 효율은 100%가 될 수 없다", { size: 12 })}`,
);

export const FIGURES = {
  geotime: { svg: geo, cap: "지질 시대의 상대적 길이(실제 비율). 아래 막대는 최근 약 5.4억 년을 확대한 것이다." },
  selection: { svg: selection, cap: "자연선택: 환경에 유리한 형질을 가진 개체의 비율이 세대를 거치며 늘어난다(단순화한 모형)." },
  redox: { svg: redox, cap: "산화 구리(Ⅱ)는 산소를 잃어 환원되고, 탄소는 산소를 얻어 산화된다. 산화와 환원은 동시에 일어난다." },
  ph: { svg: ph, cap: "pH 척도(25 ℃). 위치는 대략적인 값이다." },
  neutral: { svg: neutral, cap: "묽은 염산에 수산화 나트륨 수용액을 넣을 때 이온 수의 변화. 전체 이온 수는 중화점까지 일정하다." },
  ecosystem: { svg: ecosystem, cap: "생태계 구성 요소는 서로 영향을 주고받는다." },
  pyramid: { svg: pyramid, cap: "생태 피라미드: 상위 영양 단계로 갈수록 에너지양이 줄어든다." },
  greenhouse: { svg: greenhouse, cap: "온실 효과(단순화한 그림). 온실 기체가 늘면 온실 효과가 강화되어 지구온난화가 나타난다." },
  elnino: { svg: elnino, cap: "평상시에는 무역풍으로 따뜻한 물이 서쪽에 모이고 동쪽에서 용승이 일어난다. 엘니뇨 때는 무역풍이 약해져 따뜻한 물이 동쪽으로 퍼진다." },
  earthenergy: { svg: earthenergy, cap: "지구의 에너지원. 화석 연료·바람·수력의 근원은 태양 에너지이다." },
  generator: { svg: generator, cap: "발전 방식에 따른 에너지 전환." },
  efficiency: { svg: efficiency, cap: "에너지 효율을 구하는 예시." },
};
