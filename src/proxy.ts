import { NextResponse, type NextRequest } from "next/server";

// Optimistic redirect only: real session validation happens on the server for
// every page and API call. This just avoids rendering protected pages for
// visitors without a session cookie.
export function proxy(request: NextRequest) {
  if (!request.cookies.has("nexo_session")) {
    const url = request.nextUrl.clone();
    url.pathname = "/entrar";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/atendimento/:path*", "/perfil/:path*", "/console/:path*"],
};
