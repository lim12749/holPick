import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 홈 디렉터리의 lockfile 때문에 Turbopack 루트가 잘못 추론되는 것을 막는다.
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
