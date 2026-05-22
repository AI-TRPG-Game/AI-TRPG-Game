import { renderApp } from "./ui/app.js";
import { createSession, loadSession, listSessions } from "./store/stateStore.js";

async function bootstrap() {
  const sessions = listSessions();
  let sessionId = sessions[0]?.id;

  if (!sessionId) {
    const s = createSession();
    sessionId = s.id;
  }

  const session = loadSession(sessionId);
  renderApp({ sessionId, session });
}

bootstrap();
