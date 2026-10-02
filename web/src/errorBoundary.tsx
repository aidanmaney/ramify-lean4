import { Component, type ErrorInfo, type ReactNode } from "react";
import {
  CHROME_BORDER,
  CHROME_FONT,
  CHROME_INK,
  CHROME_BTN,
  CHROME_RADIUS,
  CHROME_TEXT,
  CHROME_TEXT_SM,
    chromeScopeProps,
} from "./theme";

type Props = {
  /** Proof identity: a change resets the boundary, so the next proof is drawn. */
  resetKey: string;
  children: ReactNode;
};
type State = { error: Error | null; key: string };

/**
 * A render exception in the proof view must not blank the infoview: it draws
 * a compact message in the widget's own error style and offers a retry. It
 * resets by itself when `resetKey` (the proof's identity) changes.
 */
export class WidgetBoundary extends Component<Props, State> {
  state: State = { error: null, key: this.props.resetKey };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey === state.key
      ? null
      : { error: null, key: props.resetKey };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[proof-tree] render error:", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div
        role="alert"
        {...chromeScopeProps()}
        style={{
          fontFamily: CHROME_FONT,
          fontSize: CHROME_TEXT,
          color: CHROME_INK,
          padding: 4,
          overflowWrap: "anywhere",
        }}
      >
        The proof tree hit an error: {error.message}{" "}
        <button
          type="button"
          onClick={() => this.setState({ error: null })}
          style={{
            fontFamily: CHROME_FONT,
            fontSize: CHROME_TEXT_SM,
            padding: "1px 8px",
            cursor: "pointer",
            color: CHROME_INK,
            background: CHROME_BTN,
            border: `1px solid ${CHROME_BORDER}`,
            borderRadius: CHROME_RADIUS,
          }}
        >
          Try again
        </button>
      </div>
    );
  }
}
