const maxLineLength = 4096;
const transportError =
  /^Error: (?:RetriableError: .+|ConnectError: \[(?:unavailable|aborted|deadline_exceeded)\].*)$/;
const serverError = "Something went wrong communicating with the server. Please try again.";

interface ReplyState {
  fence: string | undefined;
  failure: string | undefined;
}

function consumeLine(state: ReplyState, line: string) {
  const fence = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
  const marker = fence?.[1];
  if (state.fence) {
    if (
      marker &&
      marker[0] === state.fence[0] &&
      marker.length >= state.fence.length &&
      fence?.[2]?.trim() === ""
    ) {
      state.fence = undefined;
    }
    state.failure = undefined;
    return;
  }
  if (marker) {
    state.fence = marker;
    state.failure = undefined;
    return;
  }
  const text = line.trimEnd();
  if (transportError.test(text) || text === serverError) {
    state.failure = text;
  } else if (text.trim() !== "" && !(state.failure && /^\s+at\s/.test(text))) {
    state.failure = undefined;
  }
}

/** Tracks a terminal Cursor diagnostic without retaining an entire streamed answer. */
export class CursorTransportFailure {
  private state: ReplyState = { fence: undefined, failure: undefined };
  private line = "";
  private overflow = false;

  push(text: string) {
    const lines = text.split("\n");
    for (const [index, part] of lines.entries()) {
      if (!this.overflow) {
        if (this.line.length + part.length > maxLineLength) {
          if (!this.state.fence) {
            const prefix = this.line + part.slice(0, maxLineLength - this.line.length);
            this.state.fence = /^ {0,3}(`{3,}|~{3,})/.exec(prefix)?.[1];
          }
          this.line = "";
          this.overflow = true;
          this.state.failure = undefined;
        } else {
          this.line += part;
        }
      }
      if (index < lines.length - 1) {
        if (!this.overflow) consumeLine(this.state, this.line);
        this.line = "";
        this.overflow = false;
      }
    }
  }

  get failure() {
    if (this.overflow) return undefined;
    const state = { ...this.state };
    consumeLine(state, this.line);
    return state.failure;
  }
}
