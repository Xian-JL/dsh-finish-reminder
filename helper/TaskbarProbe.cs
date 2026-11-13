// Read-only G-01 discovery. No icon mutation, overlay window, process injection or input.
using System;using System.Collections.Generic;using System.Diagnostics;using System.Runtime.InteropServices;
using System.Security.Cryptography;using System.Text;using System.Web.Script.Serialization;using System.Windows.Automation;
class TaskbarProbe {
 [StructLayout(LayoutKind.Sequential)] struct Key {public Guid format;public uint id;}
 [StructLayout(LayoutKind.Explicit)] struct Variant {[FieldOffset(0)]public ushort type;[FieldOffset(8)]public IntPtr pointer;}
 [ComImport,Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface Store {
  void GetCount(out uint count);void GetAt(uint index,out Key key);void GetValue(ref Key key,out Variant value);void SetValue(ref Key key,ref Variant value);void Commit();
 }
 [DllImport("shell32.dll",PreserveSig=true)]static extern int SHGetPropertyStoreForWindow(IntPtr window,ref Guid iid,[MarshalAs(UnmanagedType.Interface)]out Store value);
 [DllImport("ole32.dll")]static extern int PropVariantClear(ref Variant value);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)]static extern IntPtr FindWindow(string klass,string title);
 [DllImport("user32.dll")]static extern uint GetWindowThreadProcessId(IntPtr window,out uint pid);
 static string Hash(string value) {using(var sha=SHA256.Create())return BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(value))).Replace("-","").ToLowerInvariant();}
 [STAThread]static int Main(string[] args) {
  try {
   if(args.Length!=1)return 2;IntPtr window=new IntPtr(long.Parse(args[0]));uint pid;GetWindowThreadProcessId(window,out pid);
   using(var process=Process.GetProcessById((int)pid))if(!process.MainModule.FileName.EndsWith("\\DeepSeek Harness.exe",StringComparison.OrdinalIgnoreCase))return 3;
   string appId="";Store store;var iid=typeof(Store).GUID;
   int result=SHGetPropertyStoreForWindow(window,ref iid,out store);
   if(result==0) {try{var key=new Key{format=new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"),id=5};Variant v;store.GetValue(ref key,out v);try{if(v.type==31)appId=Marshal.PtrToStringUni(v.pointer)??"";}finally{PropVariantClear(ref v);}}finally{Marshal.ReleaseComObject(store);}}
   var taskbar=FindWindow("Shell_TrayWnd",null);if(taskbar==IntPtr.Zero)throw new Exception("TASKBAR_UNAVAILABLE");
   var root=AutomationElement.FromHandle(taskbar);
   var buttons=root.FindAll(TreeScope.Descendants,new PropertyCondition(AutomationElement.ControlTypeProperty,ControlType.Button));
   int explicitMatches=0,titleCandidates=0;var candidateIds=new List<string>();
   foreach(AutomationElement button in buttons){
    string id=button.Current.AutomationId??"",name=button.Current.Name??"";
    if(appId.Length>0&&id=="Appid:"+appId)explicitMatches++;
    if(name.IndexOf("DeepSeek Harness",StringComparison.OrdinalIgnoreCase)>=0){titleCandidates++;candidateIds.Add(Hash(id));}
   }
   var receipt=new{status="PARTIAL",scope="read-only actual DSH window property and primary taskbar buttons; title candidates are diagnostic only",explicitAppIdAvailable=appId.Length>0,
     appIdHash=appId.Length>0?Hash(appId):null,explicitMatches=explicitMatches,titleCandidates=titleCandidates,candidateAutomationIdHashes=candidateIds,
     bindingProven=appId.Length>0&&explicitMatches==1,renderingTested=false,reason=appId.Length==0?"EXPLICIT_APPID_UNAVAILABLE":"RENDERING_NOT_VERIFIED"};
   Console.WriteLine(new JavaScriptSerializer().Serialize(receipt));return 0;
  } catch {Console.WriteLine("{\"status\":\"FAIL\",\"reason\":\"TASKBAR_PROBE_UNAVAILABLE\"}");return 1;}
 }
}
