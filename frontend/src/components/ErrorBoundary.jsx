import { Component } from "react";

// Error boundaries must be class components - React has no hook equivalent.
// Catches render/lifecycle errors anywhere below it and shows a fallback
// instead of leaving the user with a blank white page.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("Unhandled error in component tree:", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="page-loader" style={{ flexDirection: "column", gap: 12 }}>
          <h2>Something went wrong</h2>
          <p className="muted">The page hit an unexpected error. Reloading usually fixes it.</p>
          <button className="btn btn-primary" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
