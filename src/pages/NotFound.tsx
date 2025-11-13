import { useLocation } from "react-router-dom";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Home } from "lucide-react";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 text-foreground">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-8 text-center shadow-lg space-y-6">
        <div className="flex flex-col items-center gap-4">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Home className="h-8 w-8" />
          </span>
          <div>
            <h1 className="text-4xl font-bold">404</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              你访问的页面不存在或已被移除
            </p>
          </div>
        </div>
        <div className="space-y-3">
          <Button asChild className="w-full">
            <a href="/" className="inline-flex w-full items-center justify-center gap-2">
              <Home className="h-4 w-4" />
              返回首页
            </a>
          </Button>
          <Button
            variant="outline"
            className="w-full"
            onClick={() => window.history.back()}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            返回上一页
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          如果问题持续出现，请联系支持或检查链接地址。
        </p>
      </div>
    </div>
  );
};

export default NotFound;
