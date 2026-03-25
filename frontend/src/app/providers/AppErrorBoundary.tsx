import { Component, type ErrorInfo, type ReactNode } from "react";

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
    console.error("Unexpected UI error", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="card" style={{ padding: 20, margin: 20 }}>
          <h2 style={{ marginTop: 0 }}>Что-то пошло не так</h2>
          <p>Произошла непредвиденная ошибка интерфейса. Обновите страницу и попробуйте снова.</p>
        </div>
      );
    }

    return this.props.children;
  }
}
