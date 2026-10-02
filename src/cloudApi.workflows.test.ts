import { afterEach,beforeEach,describe,it,expect,vi } from "vitest";
import { createCloudLatexDoApi } from "./cloudApi";
import { resetCollaborationApiBaseUrlForTests } from "./collaboration/collaborationApi";
const response=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{"content-type":"application/json"}});
const project={id:"project",name:"Paper",rootPath:""};
beforeEach(()=>{localStorage.clear();history.replaceState(null,"","/");resetCollaborationApiBaseUrlForTests();localStorage.setItem("latexdo.cloud.session","session");localStorage.setItem("latexdo.cloud.client","client");});
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();resetCollaborationApiBaseUrlForTests();});
describe("hosted project workflows",()=>{
  it("sends authenticated file operations with encoded paths and exact contents",async()=>{
    const fetcher=vi.fn<typeof fetch>().mockImplementation(async()=>response({relativePath:"sections/new.tex",content:"source",exists:true}));vi.stubGlobal("fetch",fetcher);const api=createCloudLatexDoApi();
    expect(await api.readFile("project","a & b.tex")).toBe("source");expect(String(fetcher.mock.calls[0][0])).toContain("path=a%20%26%20b.tex");
    await api.writeFile("project","main.tex","\\section{Unicode α}");expect(fetcher.mock.calls[1][1]).toMatchObject({method:"PUT",body:JSON.stringify({content:"\\section{Unicode α}"})});
    // Each response is consumed once, as it would be by the network.
  });
  it("creates files, folders and research spaces and moves entries",async()=>{
    const fetcher=vi.fn<typeof fetch>().mockImplementation(async()=>response({relativePath:"new.tex",...project}));vi.stubGlobal("fetch",fetcher);const api=createCloudLatexDoApi();
    expect(await api.createFile("project","new.tex")).toBe("new.tex");expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string)).toEqual({relativePath:"new.tex",type:"file"});
    await api.createFolder("project","sections");expect(JSON.parse(fetcher.mock.calls[1][1]!.body as string)).toEqual({relativePath:"sections",type:"directory"});
    await api.moveEntry("project","new.tex","sections/new.tex");expect(JSON.parse(fetcher.mock.calls[2][1]!.body as string)).toEqual({fromRelativePath:"new.tex",toRelativePath:"sections/new.tex"});
    expect(await api.createResearchSpace()).toMatchObject(project);expect(JSON.parse(fetcher.mock.calls[3][1]!.body as string)).toEqual({folderName:"Research Space"});
    expect(await api.restoreCloudProject()).toBeNull();
  });
  it("reopens the latest owned project and creates a new project when the directory is unavailable",async()=>{
    const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(response({projects:[null,{id:1,name:"invalid"},project]})).mockResolvedValueOnce(response({error:"not supported"},404)).mockResolvedValueOnce(response(project));vi.stubGlobal("fetch",fetcher);const api=createCloudLatexDoApi();expect(await api.openProject()).toEqual(project);localStorage.removeItem("latexdo.cloud.activeProject");expect(await api.openProject()).toEqual(project);expect(fetcher.mock.calls[2][1]?.method).toBe("POST");
  });
  it("creates and rotates capabilities, then uses the new capability for presence and permissions",async()=>{
    const fetcher=vi.fn<typeof fetch>().mockImplementation(async(url,init)=>{
      if(String(url).endsWith("/share/rotate"))return response({enabled:true,token:"new/token",users:[]});
      if(String(url).endsWith("/share"))return response({enabled:true,token:"old-token",users:[]});
      if(String(url).includes("/permissions"))return response({permissions:[],isAdmin:true,currentUserRole:"admin"});
      if(init?.method==="DELETE")return new Response(null,{status:204});
      return response({enabled:true,users:[]});
    });vi.stubGlobal("fetch",fetcher);const api=createCloudLatexDoApi();
    const created=await api.createCollaborationLink("project");expect(created.shareUrl).toContain("#share=old-token");
    expect((await api.rotateCollaborationLink("project")).shareUrl).toContain("new%2Ftoken");
    expect((await api.getCollaborationState("project")).token).toBe("new/token");await api.updateCollaborationPresence("project","main.tex");
    expect(await api.getCollaborationPermissions("project")).toMatchObject({isAdmin:true});expect(await api.isProjectAdmin("project")).toBe(true);
    await api.updateCollaborationPermission("project",{clientId:"guest",role:"viewer"});await api.removeCollaborator("project","guest/id");
    const requests=fetcher.mock.calls;expect(requests.some(([url])=>String(url).includes("new%2Ftoken/permissions"))).toBe(true);expect(String(requests.at(-1)![0])).toContain("collaborators/guest%2Fid");expect(requests.at(-1)![1]?.method).toBe("DELETE");
  });
  it("fails closed without a capability or when permissions cannot be retrieved",async()=>{
    const fetcher=vi.fn<typeof fetch>().mockImplementation(async()=>response({error:"denied"},403));vi.stubGlobal("fetch",fetcher);const api=createCloudLatexDoApi();
    expect(await api.getCollaborationState("project")).toEqual({enabled:false,users:[]});expect(await api.updateCollaborationPresence("project",null)).toEqual({enabled:false,users:[]});
    expect(await api.getCollaborationPermissions("project")).toEqual({permissions:[],isAdmin:false,currentUserRole:"viewer"});expect(await api.isProjectAdmin("project")).toBe(false);
    await expect(api.updateCollaborationPermission("project",{clientId:"guest",role:"admin"})).rejects.toThrow("No share token");await expect(api.removeCollaborator("project","guest")).rejects.toThrow("No share token");
    fetcher.mockResolvedValueOnce(response({enabled:true,token:"capability",users:[]}));await api.getCollaborationState("project");
    expect(await api.getCollaborationPermissions("project")).toMatchObject({isAdmin:false,currentUserRole:"viewer"});expect(await api.isProjectAdmin("project")).toBe(false);
  });
  it.each(["readPdf","readAsset"] as const)("downloads bounded binary data through %s",async method=>{
    const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(new Uint8Array([37,80,68,70]))).mockResolvedValueOnce(new Response("denied",{status:403})).mockResolvedValueOnce(new Response("x",{headers:{"content-length":"999999999"}}));vi.stubGlobal("fetch",fetcher);const api=createCloudLatexDoApi();
    expect(Array.from(await api[method]("project","figure 1.pdf"))).toEqual([37,80,68,70]);await expect(api[method]("project","missing.pdf")).rejects.toThrow("403");await expect(api[method]("project","huge.pdf")).rejects.toThrow(/limit|large|MB/i);
  });
  it("round-trips proofreading and spell-check preferences and reports unsupported proofreading",async()=>{
    const api=createCloudLatexDoApi();const spell={...await api.getSpellCheckerSettings(),enabled:false};await api.updateSpellCheckerSettings(spell);expect(await api.getSpellCheckerSettings()).toEqual(spell);const proof={...await api.getProofreadingSettings(),enabled:true};await api.updateProofreadingSettings(proof);expect(await api.getProofreadingSettings()).toEqual(proof);expect(await api.proofreadDocument("main.tex","some content")).toMatchObject({diagnostics:[],checkedTextLength:12});
  });
  it("retrieves metadata and rejects failed scholarly and extension sources",async()=>{
    const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(response({title:"Paper"})).mockResolvedValueOnce(response({},403)).mockResolvedValueOnce(response({extensions:[]})).mockResolvedValueOnce(response({},404));vi.stubGlobal("fetch",fetcher);const api=createCloudLatexDoApi();expect(await api.fetchScholarlyJson("https://example.org/paper")).toEqual({title:"Paper"});await expect(api.fetchScholarlyJson("https://example.org/paper")).rejects.toThrow("HTTP 403");expect(await api.fetchExtensionCatalog()).toEqual({extensions:[]});await expect(api.fetchExtensionCatalog()).rejects.toThrow("HTTP 404");
  });
});
