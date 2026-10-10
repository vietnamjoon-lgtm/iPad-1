/**
 * 단어 모으기(study.html)와 공부 페이지 AI 퀴즈(kit/app.js)가 함께 쓰는 Apps Script 웹앱.
 * Gemini API 키는 이 스크립트의 스크립트 속성에만 있고, 사이트(공개 저장소)에는 들어가지 않는다.
 *  - 단어 모으기: 단어장 PDF 쪽 이미지를 받아서 표제어와 한국어 뜻만 뽑아 JSON으로 돌려준다.
 *  - AI 퀴즈: 사이트가 만든 문제 출제·채점 요청을 Gemini에 전달하고 답(JSON 문자열)을 돌려준다.
 *
 * 설정 (자세한 순서는 DEPLOY.md 의 "단어 모으기" 참고):
 *  1) 프로젝트 설정(톱니바퀴) > 스크립트 속성 에 추가
 *       GEMINI_API_KEY : Google AI Studio에서 발급한 키
 *       GEMINI_MODEL   : (선택) 쓸 모델. 비워두면 아래 DEFAULT_MODEL
 *       GEMINI_QUIZ_MODEL : (선택) AI 퀴즈에만 쓸 모델. 비워두면 GEMINI_MODEL과 같은 모델
 *  2) 배포 > 새 배포 > 웹 앱
 *       - 실행: 나(본인)
 *       - 액세스 권한: 모든 사용자
 *     배포하면 나오는 웹앱 URL(.../exec)을 vocab.js 의 VOCAB_SCRIPT_URL 에 붙여넣으세요.
 *
 * 단어 요청:  { day: 3, images: ["<JPEG base64>", ...] }
 * 단어 응답:  { ok: true, words: [{ word, meaning }, ...] }  또는  { ok: false, error }
 * 퀴즈 요청:  { action: "quiz", prompt: "…", schema: {…}, temperature: 1 }
 * 퀴즈 응답:  { ok: true, text: "<Gemini가 만든 JSON 문자열>" }  또는  { ok: false, error }
 */

const DEFAULT_MODEL = "gemini-3.5-flash-lite"; // 빠르고 가벼운 모델 (생각을 최소로 해서 응답이 빠름)

const PROMPT = [
  "이 이미지들은 영어 단어장의 한 Day 분량 페이지들이에요. 페이지 순서대로 읽어 주세요.",
  "각 표제어(굵게 크게 적힌 메인 영어 단어)와 그 한국어 뜻만 뽑아 주세요.",
  "- 예문, 예문 해석, 어원 설명, 발음기호, 파생어·유의어·반의어 목록은 모두 빼세요.",
  "- 뜻이 여러 개면 책에 적힌 대로 쉼표로 이어서 한 줄로 쓰세요. 품사 표시(명, 동, 형 등)는 빼세요.",
  "- 책에 나온 순서를 지키고, 같은 표제어를 두 번 넣지 마세요.",
  "- 이미지에 없는 단어나 뜻을 지어내지 마세요.",
].join("\n");

const SCHEMA = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: {
      word: { type: "STRING", description: "표제어 (영어)" },
      meaning: { type: "STRING", description: "한국어 뜻" },
    },
    required: ["word", "meaning"],
  },
};

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (body.action === "quiz") return json({ ok: true, text: quizText(body) });
    const images = body.images || [];
    if (!images.length) throw new Error("이미지가 없어요");
    return json({ ok: true, words: extractWords(images) });
  } catch (err) {
    return json({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

// 브라우저에서 URL을 그냥 열었을 때 살아있는지 확인용
function doGet() {
  const hasKey = !!PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");
  return ContentService.createTextOutput(
    "Vocab extractor is running. API key: " + (hasKey ? "OK" : "없음 (스크립트 속성에 GEMINI_API_KEY 추가 필요)") + " · quiz: ready"
  );
}

function extractWords(images) {
  const props = PropertiesService.getScriptProperties();
  const key = props.getProperty("GEMINI_API_KEY");
  if (!key) throw new Error("스크립트 속성에 GEMINI_API_KEY가 없어요");
  const model = props.getProperty("GEMINI_MODEL") || DEFAULT_MODEL;

  const parts = [{ text: PROMPT }];
  for (const data of images) parts.push({ inline_data: { mime_type: "image/jpeg", data: data } });

  const res = UrlFetchApp.fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent",
    {
      method: "post",
      contentType: "application/json",
      headers: { "x-goog-api-key": key },
      muteHttpExceptions: true,
      payload: JSON.stringify({
        contents: [{ role: "user", parts: parts }],
        generationConfig: {
          temperature: 0,
          responseMimeType: "application/json",
          responseSchema: SCHEMA,
        },
      }),
    }
  );

  const status = res.getResponseCode();
  const result = JSON.parse(res.getContentText());
  if (status !== 200) {
    throw new Error("Gemini 오류 " + status + ": " + (result.error && result.error.message));
  }
  const text = (((result.candidates || [])[0] || {}).content || {}).parts;
  if (!text || !text.length) throw new Error("Gemini가 빈 답을 줬어요 (" + JSON.stringify(result.promptFeedback || {}) + ")");
  const words = JSON.parse(text.map(function (p) { return p.text || ""; }).join(""));
  return words
    .filter(function (w) { return w && w.word; })
    .map(function (w) { return { word: String(w.word).trim(), meaning: String(w.meaning || "").trim() }; });
}

// AI 퀴즈: 사이트가 보낸 출제·채점 지시문을 Gemini에 전달한다.
// 사이트 주소를 아는 누구나 부를 수 있으므로 길이와 설정값을 제한한다.
const QUIZ_MAX_PROMPT = 40000;

function quizText(body) {
  const prompt = String(body.prompt || "");
  if (!prompt) throw new Error("문제 지시문이 없어요");
  if (prompt.length > QUIZ_MAX_PROMPT) throw new Error("지시문이 너무 길어요");
  const schema = body.schema && typeof body.schema === "object" ? body.schema : null;
  const temperature = Math.max(0, Math.min(1.5, Number(body.temperature) || 0));

  const props = PropertiesService.getScriptProperties();
  const key = props.getProperty("GEMINI_API_KEY");
  if (!key) throw new Error("스크립트 속성에 GEMINI_API_KEY가 없어요");
  const model = props.getProperty("GEMINI_QUIZ_MODEL") || props.getProperty("GEMINI_MODEL") || DEFAULT_MODEL;

  const config = { temperature: temperature, responseMimeType: "application/json" };
  if (schema) config.responseSchema = schema;
  const res = UrlFetchApp.fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent",
    {
      method: "post",
      contentType: "application/json",
      headers: { "x-goog-api-key": key },
      muteHttpExceptions: true,
      payload: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: config }),
    }
  );
  const status = res.getResponseCode();
  const result = JSON.parse(res.getContentText());
  if (status !== 200) {
    throw new Error("Gemini 오류 " + status + ": " + (result.error && result.error.message));
  }
  const parts = (((result.candidates || [])[0] || {}).content || {}).parts;
  const text = (parts || []).map(function (p) { return p.text || ""; }).join("");
  if (!text) throw new Error("Gemini가 빈 답을 줬어요");
  return text;
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
