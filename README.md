# iPad-1

카메라로 몸을 인식하는 웹 앱 모음이에요.

| 페이지 | 설명 |
|---|---|
| `index.html` | 🏠 홈: 아래 페이지를 고르는 메인 화면 |
| `hand.html` | 🖐 손 3D 미러: 3D 손 모델이 내 손을 실시간으로 따라 움직여요 |
| `pingpong.html` | 🏓 1인칭 탁구: 팔을 휘둘러서 AI와 탁구를 쳐요 (MediaPipe Pose) |
| `study.html` | 📚 Study Guard: 졸거나 엎드리면 알람이 울려요 (MediaPipe Face Landmarker). 📖 단어장 PDF에서 Day별 단어·뜻 모으기 + 퀴즈 (Gemini) |
| `history.html` | 📜 한국사2 공부 (2022 개정, 해냄에듀 목차 순서): 주제 30개 핵심 정리·용어 사전·연표·비교표·퀴즈 + 키워드 검색. 카메라 없이 쓰는 페이지이고, 내용은 `history/unit1~3.js`에 있어요 |

- 손 인식: [MediaPipe Hand Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker) (손 관절 21개, 최대 2손)
- 3D 렌더링: [Three.js](https://threejs.org/)
- 빌드 과정 없이 HTML/CSS/JS만 사용해요.
- 세 페이지 모두 카메라를 켠 순간부터 끌 때까지 녹화해서 3분마다 구글 드라이브에 저장해요.
- 녹화 영상 드라이브 저장, 단어 모으기(Gemini) 설정은 [`DEPLOY.md`](DEPLOY.md)를 보세요.

## 실행 방법

카메라는 `https` 또는 `localhost`에서만 켜져요.

```bash
python3 -m http.server 8000
```

브라우저에서 `http://localhost:8000`을 열고 **카메라 켜고 시작**을 누르세요.
Codespaces에서는 포워딩된 8000번 포트 주소(https)로 열면 돼요.

## 사용법

- 손을 카메라에 보여 주면 3D 손이 거울처럼 따라 움직여요.
- 화면을 드래그하면 3D 시점을 돌릴 수 있고, 핀치/스크롤로 확대할 수 있어요.
- 왼손은 파란색, 오른손은 주황색으로 보여요.
