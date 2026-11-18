import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = { children: ReactNode };
type State = { error: Error | null };

/** Top-level catch so a boot crash shows a reload UI instead of a blank page. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('App crash', error, info.componentStack);
  }

  private reload = () => {
    window.location.reload();
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        style={{
          minHeight: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          background: '#F5F8FC',
          color: '#172B4D',
          fontFamily: 'IBM Plex Sans, ui-sans-serif, system-ui, sans-serif',
        }}
      >
        <div style={{ maxWidth: 420, textAlign: 'center' }}>
          <h1 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 600 }}>
            Something went wrong
          </h1>
          <p style={{ margin: '0 0 16px', color: '#718096', fontSize: 14, lineHeight: 1.5 }}>
            The CRM hit an unexpected error. Reload to try again. If it keeps happening,
            share this message with eng:
          </p>
          <pre
            style={{
              margin: '0 0 20px',
              padding: 12,
              textAlign: 'left',
              fontSize: 12,
              lineHeight: 1.4,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              background: '#FFFFFF',
              border: '1px solid #E2E8F0',
              borderRadius: 8,
              color: '#EF4444',
            }}
          >
            {error.message}
          </pre>
          <button
            type="button"
            onClick={this.reload}
            style={{
              appearance: 'none',
              border: 'none',
              borderRadius: 8,
              padding: '10px 18px',
              background: '#174A8B',
              color: '#FFFFFF',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
