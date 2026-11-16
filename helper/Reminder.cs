using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows;
using System.Windows.Automation;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Effects;
using System.Windows.Threading;
using Microsoft.Win32;
[assembly: System.Reflection.AssemblyVersion("0.3.1.0")]
[assembly: System.Reflection.AssemblyFileVersion("0.3.1.0")]

namespace DshFinishReminder {
  static class Native {
    [StructLayout(LayoutKind.Sequential)] public struct Rect { public int left,top,right,bottom; }
    [StructLayout(LayoutKind.Sequential)] public struct Point { public int x,y; }
    [StructLayout(LayoutKind.Sequential)] public struct MonitorInfo { public int size; public Rect monitor,work; public int flags; }
    [StructLayout(LayoutKind.Sequential)] public struct AppBar { public int size; public IntPtr hwnd; public uint callback,edge; public Rect rect; public IntPtr param; }
    [StructLayout(LayoutKind.Sequential)] public struct InputSource { public int device,origin; }
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern IntPtr MonitorFromPoint(Point p,uint flags);
    [DllImport("user32.dll")] public static extern bool GetMonitorInfo(IntPtr h,ref MonitorInfo info);
    [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h,int n);
    [DllImport("user32.dll")] public static extern int SetWindowLong(IntPtr h,int n,int value);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h,IntPtr after,int x,int y,int w,int height,uint flags);
    [DllImport("user32.dll")] public static extern bool GetCurrentInputMessageSource(out InputSource source);
    [DllImport("user32.dll")] public static extern IntPtr OpenInputDesktop(uint flags,bool inherit,uint access);
    [DllImport("user32.dll")] public static extern bool CloseDesktop(IntPtr desktop);
    [DllImport("shell32.dll")] public static extern UIntPtr SHAppBarMessage(uint message,ref AppBar data);
    [DllImport("shcore.dll")] public static extern int GetDpiForMonitor(IntPtr monitor,int type,out uint x,out uint y);
    [DllImport("dwmapi.dll")] public static extern int DwmFlush();
    [DllImport("user32.dll")] public static extern bool GetCursorPos(out Point point);
  }
  static class Program {
    static JavaScriptSerializer json=new JavaScriptSerializer {MaxJsonLength=131072,RecursionLimit=20};
    static object outputLock=new object();static Dispatcher ui;static Popup popup;static Application app;
    static string nonce,owner;static int generation;static long revision;static bool closing,locked,sleeping;
    static Process parent;static DateTime parentStart;static Mutex mutex;static bool ownsMutex;
    static Dictionary<string,object> lastView;
    public static Action environmentChanged;
    public static string S(Dictionary<string,object> d,string k) {object v;return d.TryGetValue(k,out v)&&v is string?(string)v:"";}
    public static int I(Dictionary<string,object> d,string k) {return checked((int)D(d,k));}
    public static double D(Dictionary<string,object> d,string k) {object v;if(!d.TryGetValue(k,out v))throw new Exception("PROTOCOL_ERROR");return Convert.ToDouble(v,System.Globalization.CultureInfo.InvariantCulture);}
    public static bool B(Dictionary<string,object> d,string k) {object v;return d.TryGetValue(k,out v)&&v is bool&&(bool)v;}
    static Dictionary<string,object> Obj(object o) {var d=o as Dictionary<string,object>;if(d==null)throw new Exception("PROTOCOL_ERROR");return d;}
    public static string Outcome(string k) {
      switch(k) {case "ended":return "对话任务已结束";case "error":return "对话任务已结束（失败）";case "stopped":return "对话任务已停止";case "interrupted":return "对话任务已中断";case "limited":return "本轮已结束（达到限制）";case "blocked":return "本轮已结束（受阻）";default:return "本轮已结束（原因未知）";}
    }
    static void Send(string request,string type,object payload) {
      var m=new Dictionary<string,object> {{"protocolVersion",1},{"nonce",nonce},{"ownerInstance",owner},{"generation",generation},{"requestId",request},{"revision",revision},{"type",type},{"payload",payload}};
      lock(outputLock) {string line=new JavaScriptSerializer().Serialize(m);if(Encoding.UTF8.GetByteCount(line)>32768)throw new Exception("PROTOCOL_ERROR");Console.WriteLine(line);Console.Out.Flush();}
    }
    static void Event(string kind,string cardId,int displayGeneration,bool paused) {
      var payload=new Dictionary<string,object>{{"kind",kind},{"cardId",cardId},{"displayGeneration",displayGeneration}};
      if(kind=="hover")payload["paused"]=paused;
      Send(Guid.NewGuid().ToString(),"event",payload);
    }
    static void Availability() {
      bool available=Available();if(!available&&popup!=null)popup.HideImmediate();
      Send(Guid.NewGuid().ToString(),"event",new Dictionary<string,object>{{"kind","availability"},{"available",available}});
    }
    static bool Available() {
      if(locked||sleeping)return false;
      IntPtr desktop=Native.OpenInputDesktop(0,false,0x0100);if(desktop==IntPtr.Zero)return false;
      Native.CloseDesktop(desktop);return true;
    }
    static Dictionary<string,object> Geometry(int previews) {
      var monitor=Native.MonitorFromPoint(new Native.Point(),1);
      var info=new Native.MonitorInfo();info.size=Marshal.SizeOf(info);
      var bar=new Native.AppBar();bar.size=Marshal.SizeOf(bar);
      if(!Native.GetMonitorInfo(monitor,ref info)||Native.SHAppBarMessage(5,ref bar)==UIntPtr.Zero||bar.edge!=3)throw new Exception("DISPLAY_UNAVAILABLE");
      uint x,y;if(Native.GetDpiForMonitor(monitor,0,out x,out y)!=0)throw new Exception("DISPLAY_UNAVAILABLE");
      double scale=x/96.0;
      bool autoHide=(Native.SHAppBarMessage(4,ref bar).ToUInt64()&1)!=0;
      int thickness=bar.rect.bottom-bar.rect.top;
      if(autoHide&&thickness<16*scale)throw new Exception("DISPLAY_UNAVAILABLE");
      int bottom=Math.Min(info.work.bottom,Math.Min(bar.rect.top,info.monitor.bottom-thickness));
      var result=ReceiptLayout.Calculate(info.work.left,info.work.top,info.work.right,bottom,x,previews,ReceiptLayout.SystemTextScale());result["dpi"]=x;result["autoHide"]=autoHide;return result;
    }
    static void View(Dictionary<string,object> p) {
      lastView=p;object front;
      if(!Available()||!B(p,"available")){if(popup!=null)popup.HideImmediate();return;}
      if(!p.TryGetValue("front",out front)||front==null){if(popup!=null)popup.Leave();return;}
      var f=Obj(front);string title=S(f,"displayTitle"),id=S(f,"cardId"),state=S(f,"state"),outcome=S(f,"outcome"),error=S(f,"error");
      if(title.Length>320||id.Length==0||id.Length>2048||I(f,"displayGeneration")<0||D(f,"remainingFrontMs")<0||D(f,"remainingFrontMs")>10000||
        (state!="front"&&state!="painting"&&state!="paused"&&state!="opening")||Array.IndexOf(new string[]{"ended","error","stopped","interrupted","limited","blocked","unknown"},outcome)<0)throw new Exception("PROTOCOL_ERROR");
      if(error.Length>0&&!System.Text.RegularExpressions.Regex.IsMatch(error,"^[A-Z_]{1,64}$"))throw new Exception("PROTOCOL_ERROR");
      double receipt=D(f,"receiptNumber");if(Double.IsNaN(receipt)||Double.IsInfinity(receipt)||receipt<1||receipt>9007199254740991||receipt!=Math.Floor(receipt))throw new Exception("PROTOCOL_ERROR");
      if(S(f,"workspaceTitle").Length>160)throw new Exception("PROTOCOL_ERROR");
      object previewsObj;if(!p.TryGetValue("previews",out previewsObj)||!(previewsObj is IList))throw new Exception("PROTOCOL_ERROR");
      var list=(IList)previewsObj;if(list.Count>2)throw new Exception("PROTOCOL_ERROR");
      var previews=new List<Dictionary<string,object>>();
      for(int i=0;i<list.Count;i++) {
        var d=Obj(list[i]);string pt=S(d,"displayTitle"),pc=S(d,"cardId"),po=S(d,"outcome");
        if(pt.Length>320||pc.Length==0||pc.Length>2048||Array.IndexOf(new string[]{"ended","error","stopped","interrupted","limited","blocked","unknown"},po)<0)throw new Exception("PROTOCOL_ERROR");
        previews.Add(d);
      }
      int queued=I(p,"queued");if(queued<1||queued>10000)throw new Exception("PROTOCOL_ERROR");
      var geometry=Geometry(previews.Count);
      if(popup==null) {popup=new Popup();popup.interaction=Event;popup.painted=delegate(string c,int g){Event("painted",c,g,false);};popup.displayUnavailable=delegate{Send(Guid.NewGuid().ToString(),"event",new Dictionary<string,object>{{"kind","availability"},{"available",false}});};}
      popup.Draw(f,previews,queued,B(p,"dark"),geometry);
    }
    static object Execute(string type,Dictionary<string,object> p) {
      switch(type) {
        case "hello": return new Dictionary<string,object>{{"version","0.3.1"},{"popup",true},{"badge",true},{"navigation",true},
          {"badgeBackend","window-icon-composition"},{"acceptance","UNVERIFIED"},{"foregroundBefore",Native.GetForegroundWindow().ToInt64()}};
        case "registerDesktop":return Desktop.Register(p);
        case "bindWindow":return Desktop.Bind(p);
        case "unbindWindow":return Desktop.Unbind(p);
        case "foreground":return Desktop.Foreground(p,true);
        case "verifyForeground":return Desktop.Foreground(p,false);
        case "badge":return Desktop.Badge(p);
        case "observeCompletion":return Desktop.ObserveCompletion(p);
        case "forgetCompletion":return Desktop.ForgetCompletion(p);
        case "geometry":return Geometry(2);
        case "syncView":View(p);return new Dictionary<string,object>{{"applied",true},{"foregroundAfter",Native.GetForegroundWindow().ToInt64()}};
        case "shutdown":ui.BeginInvoke(new Action(Stop));return new Dictionary<string,object>{{"closed",true}};
        default:throw new Exception("PROTOCOL_ERROR");
      }
    }
    static void Handle(Dictionary<string,object> m) {
      string request=S(m,"requestId");
      try {
        if(I(m,"protocolVersion")!=1||request.Length==0||request.Length>80)throw new Exception("PROTOCOL_ERROR");
        if(nonce==null) {
          if(S(m,"type")!="hello")throw new Exception("PROTOCOL_ERROR");
          nonce=S(m,"nonce");owner=S(m,"ownerInstance");generation=I(m,"generation");
          if(nonce.Length<32||nonce.Length>80||owner.Length<32||owner.Length>80||generation<0)throw new Exception("PROTOCOL_ERROR");
        }
        if(S(m,"nonce")!=nonce||S(m,"ownerInstance")!=owner||I(m,"generation")!=generation)throw new Exception("PROTOCOL_ERROR");
        long rev=checked((long)D(m,"revision"));if(rev<revision)throw new Exception("PROTOCOL_ERROR");revision=rev;
        var result=Execute(S(m,"type"),Obj(m["payload"]));
        Send(request,"response",new Dictionary<string,object>{{"ok",true},{"value",result}});
      } catch(Exception ex) {
        string code=ex.Message; if(!System.Text.RegularExpressions.Regex.IsMatch(code,"^[A-Z_]{1,64}$"))code="PROTOCOL_ERROR";
        Send(request,"response",new Dictionary<string,object>{{"ok",false},{"code",code}});
      }
    }
    static void Read() {
      try {
        var input=Console.OpenStandardInput();var bytes=new MemoryStream();int b;
        while((b=input.ReadByte())>=0) {
          if(b==10) {
            var text=new UTF8Encoding(false,true).GetString(bytes.ToArray());bytes.SetLength(0);
            var message=Obj(json.DeserializeObject(text));ui.Invoke(new Action(delegate{Handle(message);}));
          } else {if(bytes.Length>=131072)throw new Exception("PROTOCOL_ERROR");bytes.WriteByte((byte)b);}
        }
      } catch {} finally {ui.BeginInvoke(new Action(Stop));}
    }
    static void Stop() {if(closing)return;closing=true;Desktop.ReleaseAll();if(popup!=null)popup.Close();app.Shutdown();}
    static void DisplayChanged(object sender,EventArgs e) {
      ui.BeginInvoke(new Action(delegate {Availability();if(lastView!=null&&Available())try{View(lastView);}catch{Availability();}}));
    }
    [STAThread] public static int Main(string[] args) {
      try {
        Console.OutputEncoding=new UTF8Encoding(false);
        if(args.Length!=1)return 2;
        parent=Process.GetProcessById(int.Parse(args[0]));parentStart=parent.StartTime;
        // No second native owner in this interactive login session. Other instances fail explicitly.
        bool created;
        mutex=new Mutex(true,"Local\\DshFinishReminder-v1-"+Desktop.GroupIdentity(parent.Id),out created);ownsMutex=created;
        if(!created)return 3;
        app=new Application();app.ShutdownMode=ShutdownMode.OnExplicitShutdown;ui=Dispatcher.CurrentDispatcher;Desktop.InitializeInputClassification();
        environmentChanged=delegate{DisplayChanged(null,EventArgs.Empty);};
        Desktop.ObserveEnvironment(environmentChanged);
        SystemEvents.DisplaySettingsChanged+=DisplayChanged;SystemEvents.UserPreferenceChanged+=DisplayChanged;
        SessionSwitchEventHandler session=delegate(object sender,SessionSwitchEventArgs e){ui.BeginInvoke(new Action(delegate{locked=e.Reason==SessionSwitchReason.SessionLock;if(e.Reason==SessionSwitchReason.SessionUnlock)locked=false;Availability();}));};
        PowerModeChangedEventHandler power=delegate(object sender,PowerModeChangedEventArgs e){ui.BeginInvoke(new Action(delegate{sleeping=e.Mode==PowerModes.Suspend;Availability();}));};
        SystemEvents.SessionSwitch+=session;SystemEvents.PowerModeChanged+=power;
        var watch=new DispatcherTimer{Interval=TimeSpan.FromSeconds(2)};
        watch.Tick+=delegate {try{if(parent.HasExited||parent.StartTime!=parentStart)Stop();else Desktop.Refresh();}catch{Stop();}};watch.Start();
        var reader=new Thread(Read);reader.IsBackground=true;reader.Start();app.Run();watch.Stop();
        SystemEvents.DisplaySettingsChanged-=DisplayChanged;SystemEvents.UserPreferenceChanged-=DisplayChanged;
        SystemEvents.SessionSwitch-=session;SystemEvents.PowerModeChanged-=power;
        return 0;
      } catch {return 1;}
      finally {if(ownsMutex&&mutex!=null)mutex.ReleaseMutex();if(mutex!=null)mutex.Dispose();if(parent!=null)parent.Dispose();}
    }
  }
}
