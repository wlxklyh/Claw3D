"use client";

import { Component, createRef, type ReactNode } from "react";
import styles from "./workbench.module.css";

/** A WebGL problem must not hide task records or human decisions. */
export class OfficeBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  private host = createRef<HTMLDivElement>();
  private handleContextLost = () => { this.setState({ failed: true }); };
  componentDidMount() {
    this.host.current?.addEventListener("webglcontextlost", this.handleContextLost, true);
  }
  componentWillUnmount() {
    this.host.current?.removeEventListener("webglcontextlost", this.handleContextLost, true);
  }
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return <div ref={this.host} style={{ width: "100%", height: "100%" }}>{this.state.failed
      ? <div className={styles.empty}><p>3D 图形连接已中断。岗位、任务和人工待办仍然可用。</p><button onClick={() => this.setState({ failed: false })}>重新载入 3D</button></div>
      : this.props.children}</div>;
  }
}
