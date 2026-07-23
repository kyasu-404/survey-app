import { Component, type ErrorInfo, type ReactNode } from "react";
import { logError } from "../../shared/lib/observability";

type AppErrorBoundaryProps = {
  children: ReactNode;
};

type AppErrorBoundaryState = {
  hasError: boolean;
};

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  constructor(props: AppErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    logError("Unexpected UI error", error, {
      operation: "ui.render",
      componentStack: info.componentStack,
    });
  }

  private reloadPage = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="card" style={{ padding: 20, margin: 20 }}>
          <h2 style={{ marginTop: 0 }}>Что-то пошло не так</h2>
          <p>Произошла непредвиденная ошибка интерфейса. Обновите страницу и попробуйте снова.</p>
          <button type="button" onClick={this.reloadPage}>Перезагрузить приложение</button>
        </div>
      );
    }

    return this.props.children;
  }
}
