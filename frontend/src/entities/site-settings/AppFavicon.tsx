import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { FAVICON_QUERY_KEY, getAppFavicon } from "./api";
import defaultFavicon from "../../img/favicon.png";
export function AppFavicon() {
  const query=useQuery({queryKey:FAVICON_QUERY_KEY,queryFn:getAppFavicon,staleTime:60_000,refetchInterval:60_000,refetchOnWindowFocus:true,retry:1});
  useEffect(()=>{
    const link=document.querySelector<HTMLLinkElement>('link[rel="icon"]')??document.head.appendChild(document.createElement("link"));
    link.rel="icon";link.type=query.data?.mime??"image/png";link.href=query.data?.url??defaultFavicon;
  },[query.data]);
  return null;
}
