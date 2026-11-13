using System;using System.Collections.Generic;using System.Diagnostics;using System.Drawing;using System.Drawing.Drawing2D;using System.Drawing.Imaging;
using System.Runtime.InteropServices;using System.Text;
namespace DshFinishReminder {
 static class Desktop {
  [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)]struct ProcessEntry {public uint size,usage,pid;public IntPtr heap;public uint module,threads,parent;public int priority;public uint flags;[MarshalAs(UnmanagedType.ByValTStr,SizeConst=260)]public string exe;}
  [StructLayout(LayoutKind.Sequential)]struct IconInfo {public bool icon;public uint x,y;public IntPtr mask,color;}
  [StructLayout(LayoutKind.Sequential)]struct Placement {public uint length,flags,show;public Native.Point min,max;public Native.Rect normal;}
  delegate bool EnumWindow(IntPtr hwnd,IntPtr arg);
  delegate IntPtr InputHook(int code,IntPtr w,IntPtr l);
  delegate void EnvironmentHook(IntPtr hook,uint evt,IntPtr hwnd,int obj,int child,uint thread,uint time);
  [DllImport("user32.dll")]static extern IntPtr SetWinEventHook(uint first,uint last,IntPtr module,EnvironmentHook callback,uint process,uint thread,uint flags);
  [DllImport("user32.dll")]static extern bool UnhookWinEvent(IntPtr hook);
  [DllImport("user32.dll")]static extern IntPtr SetWindowsHookEx(int type,InputHook callback,IntPtr module,uint thread);
  [DllImport("user32.dll")]static extern bool UnhookWindowsHookEx(IntPtr hook);
  [DllImport("user32.dll")]static extern IntPtr CallNextHookEx(IntPtr hook,int code,IntPtr w,IntPtr l);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode)]static extern IntPtr GetModuleHandle(string name);
  [DllImport("kernel32.dll")]static extern IntPtr CreateToolhelp32Snapshot(uint flags,uint pid);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode)]static extern bool Process32First(IntPtr snap,ref ProcessEntry e);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode)]static extern bool Process32Next(IntPtr snap,ref ProcessEntry e);
  [DllImport("kernel32.dll")]static extern bool CloseHandle(IntPtr h);
  [DllImport("user32.dll")]static extern bool EnumWindows(EnumWindow fn,IntPtr arg);
  [DllImport("user32.dll")]static extern uint GetWindowThreadProcessId(IntPtr hwnd,out uint pid);
  [DllImport("user32.dll")]static extern bool GetWindowRect(IntPtr hwnd,out Native.Rect rect);
  [DllImport("user32.dll")]static extern bool GetWindowPlacement(IntPtr hwnd,ref Placement p);
  [DllImport("user32.dll")]static extern uint GetDpiForWindow(IntPtr hwnd);
  [DllImport("user32.dll")]static extern bool IsWindow(IntPtr hwnd);
  [DllImport("user32.dll")]static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")]static extern bool IsIconic(IntPtr hwnd);
  [DllImport("user32.dll")]static extern bool ShowWindowAsync(IntPtr hwnd,int command);
  [DllImport("user32.dll")]static extern bool SetForegroundWindow(IntPtr hwnd);
  [DllImport("user32.dll")]static extern IntPtr GetWindow(IntPtr hwnd,uint command);
  [DllImport("user32.dll")]static extern IntPtr SendMessageTimeout(IntPtr hwnd,uint message,IntPtr w,IntPtr l,uint flags,uint ms,out IntPtr result);
  [DllImport("user32.dll")]static extern IntPtr GetClassLongPtr(IntPtr hwnd,int index);
  [DllImport("user32.dll")]static extern bool GetIconInfo(IntPtr icon,out IconInfo info);
  [DllImport("user32.dll")]static extern bool DestroyIcon(IntPtr icon);
  [DllImport("gdi32.dll")]static extern bool DeleteObject(IntPtr value);
  class Root {public int pid;public long ticks;public string exe;}
  class Binding {public string token,client;public IntPtr hwnd;public Root root;}
  class Mark {public IntPtr hwnd,originalBig,originalSmall,big,small;}
  static Dictionary<int,Root> roots=new Dictionary<int,Root>();static Dictionary<string,Binding> bindings=new Dictionary<string,Binding>();
  static Dictionary<IntPtr,Mark> marks=new Dictionary<IntPtr,Mark>();static long count;static long generation;
  static Dictionary<string,long> completionInput=new Dictionary<string,long>();static long inputSerial;static bool lastPhysical;
  static IntPtr mouseHook,keyboardHook,environmentHook;static InputHook mouseCallback,keyboardCallback;static EnvironmentHook environmentCallback;static long lastInputAt;
  public static void InitializeInputClassification(){
   // Only origin flags and a serial are observed. Keys, characters, pointer positions and target contents are never retained.
   mouseCallback=delegate(int code,IntPtr w,IntPtr l){if(code>=0){int flags=Marshal.ReadInt32(l,12);inputSerial++;lastPhysical=(flags&3)==0;lastInputAt=Stopwatch.GetTimestamp();}return CallNextHookEx(IntPtr.Zero,code,w,l);};
   keyboardCallback=delegate(int code,IntPtr w,IntPtr l){if(code>=0){int flags=Marshal.ReadInt32(l,8);inputSerial++;lastPhysical=(flags&0x12)==0;lastInputAt=Stopwatch.GetTimestamp();}return CallNextHookEx(IntPtr.Zero,code,w,l);};
   mouseHook=SetWindowsHookEx(14,mouseCallback,GetModuleHandle(null),0);keyboardHook=SetWindowsHookEx(13,keyboardCallback,GetModuleHandle(null),0);
  }
  public static bool AccessibleInput(string id){Native.InputSource source;if(Native.GetCurrentInputMessageSource(out source)&&source.origin==1)return true;long baseline;return lastPhysical&&completionInput.TryGetValue(id,out baseline)&&inputSerial>baseline&&(Stopwatch.GetTimestamp()-lastInputAt)/(double)Stopwatch.Frequency<=2;}
  public static void ObserveEnvironment(Action changed){environmentCallback=delegate{changed();};environmentHook=SetWinEventHook(0x20,0x20,IntPtr.Zero,environmentCallback,0,0,2);}
  static IEnumerable<string> CompletionIds(Dictionary<string,object> p){object list;if(p.TryGetValue("completionIds",out list)){int n=0;foreach(object value in (System.Collections.IEnumerable)list){if(++n>16||!(value is string))throw new Exception("PROTOCOL_ERROR");yield return (string)value;}}else yield return Program.S(p,"completionId");}
  public static object ObserveCompletion(Dictionary<string,object> p){foreach(string id in CompletionIds(p)){if(id.Length==0||id.Length>4096)throw new Exception("PROTOCOL_ERROR");if(!completionInput.ContainsKey(id)){if(completionInput.Count>=10000)throw new Exception("QUEUE_CAPACITY_ERROR");completionInput[id]=inputSerial;}}return new Dictionary<string,object>{{"observed",true}};}
  public static object ForgetCompletion(Dictionary<string,object> p){foreach(string id in CompletionIds(p))completionInput.Remove(id);return new Dictionary<string,object>{{"removed",true}};}
  static bool Alive(Root r){try{using(var p=Process.GetProcessById(r.pid))return !p.HasExited&&p.StartTime.ToUniversalTime().Ticks==r.ticks&&p.MainModule.FileName==r.exe;}catch{return false;}}
  static Root ResolveRoot(int pid) {
   var parents=new Dictionary<int,int>();IntPtr snap=CreateToolhelp32Snapshot(2,0);
   try{var e=new ProcessEntry();e.size=(uint)Marshal.SizeOf(e);if(Process32First(snap,ref e))do{parents[(int)e.pid]=(int)e.parent;}while(Process32Next(snap,ref e));}finally{CloseHandle(snap);}
   Root found=null;var seen=new HashSet<int>();
   while(pid>0&&seen.Add(pid)) {
    try {using(var p=Process.GetProcessById(pid)){string exe=p.MainModule.FileName;if(exe.EndsWith("\\DeepSeek Harness.exe",StringComparison.OrdinalIgnoreCase))found=new Root{pid=pid,ticks=p.StartTime.ToUniversalTime().Ticks,exe=exe};}}catch{}
    int parent;if(!parents.TryGetValue(pid,out parent))break;pid=parent;
   }
   if(found==null)throw new Exception("DESKTOP_BRIDGE_UNAVAILABLE");return found;
  }
  public static string GroupIdentity(int pid){
   string exe;try{exe=ResolveRoot(pid).exe;}catch{using(var p=Process.GetProcessById(pid))exe=p.MainModule.FileName;}
   string identity=System.Security.Principal.WindowsIdentity.GetCurrent().User.Value+"|"+exe.ToLowerInvariant();
   using(var sha=System.Security.Cryptography.SHA256.Create())return BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(identity))).Replace("-","");
  }
  public static void Refresh(){
   if(count<=0)return;bool changed=false;
   foreach(var root in new List<Root>(roots.Values))foreach(var hwnd in Windows(root)){Mark mark;if(!marks.TryGetValue(hwnd,out mark)||IconAt(hwnd,1)!=mark.big||IconAt(hwnd,0)!=mark.small)changed=true;}
   if(changed)try{Badge(new Dictionary<string,object>{{"count",count}});}catch{}
  }
  static List<IntPtr> Windows(Root root) {
   var result=new List<IntPtr>();if(!Alive(root))return result;
   EnumWindows(delegate(IntPtr hwnd,IntPtr unused){uint pid;GetWindowThreadProcessId(hwnd,out pid);if(pid==root.pid&&GetWindow(hwnd,4)==IntPtr.Zero&&(IsWindowVisible(hwnd)||IsIconic(hwnd)))result.Add(hwnd);return true;},IntPtr.Zero);return result;
  }
  public static object Register(Dictionary<string,object> p) {
   var root=ResolveRoot(Program.I(p,"hostPid"));roots[root.pid]=root;
   return new Dictionary<string,object>{{"desktop",true},{"rootIdentity",root.pid+":"+root.ticks},{"badgeBackend","window-icon-composition"},{"placement","top-right"},{"acceptance","UNVERIFIED"}};
  }
  public static object Bind(Dictionary<string,object> p) {
   var root=ResolveRoot(Program.I(p,"hostPid"));roots[root.pid]=root;
   string client=Program.S(p,"clientId");if(client.Length<8||client.Length>80)throw new Exception("PROTOCOL_ERROR");
   double x=Program.D(p,"x"),y=Program.D(p,"y"),w=Program.D(p,"width"),h=Program.D(p,"height");
   var found=new List<IntPtr>();
   foreach(var hwnd in Windows(root)) {
    Native.Rect rect;if(!GetWindowRect(hwnd,out rect))continue;
    if(IsIconic(hwnd)){var placement=new Placement();placement.length=(uint)Marshal.SizeOf(placement);if(GetWindowPlacement(hwnd,ref placement))rect=placement.normal;}
    double scale=GetDpiForWindow(hwnd)/96.0;if(scale<1||scale>4)continue;
    // Native identity + unique window geometry, never a title or first-window heuristic.
    if(Math.Abs(rect.left-x*scale)<=8*scale&&Math.Abs(rect.top-y*scale)<=8*scale&&Math.Abs(rect.right-rect.left-w*scale)<=8*scale&&Math.Abs(rect.bottom-rect.top-h*scale)<=8*scale)found.Add(hwnd);
   }
   if(found.Count!=1)throw new Exception("WINDOW_BINDING_AMBIGUOUS");
   foreach(var existing in bindings.Values)if(existing.client==client&&existing.root.pid==root.pid&&existing.hwnd==found[0])return new Dictionary<string,object>{{"windowToken",existing.token},{"bound",true},{"minimized",IsIconic(found[0])}};
   foreach(var old in new List<Binding>(bindings.Values))if(old.client==client&&old.root.pid==root.pid)bindings.Remove(old.token);
   string token=Guid.NewGuid().ToString();bindings[token]=new Binding{token=token,client=client,hwnd=found[0],root=root};
   return new Dictionary<string,object>{{"windowToken",token},{"bound",true},{"minimized",IsIconic(found[0])}};
  }
  static Binding Target(Dictionary<string,object> p) {
   Binding b;if(!bindings.TryGetValue(Program.S(p,"windowToken"),out b)||!Alive(b.root)||!IsWindow(b.hwnd))throw new Exception("TARGET_GONE");
   uint pid;GetWindowThreadProcessId(b.hwnd,out pid);if(pid!=b.root.pid)throw new Exception("TARGET_GONE");return b;
  }
  public static object Foreground(Dictionary<string,object> p,bool activate) {
   var b=Target(p);if(activate){if(IsIconic(b.hwnd))ShowWindowAsync(b.hwnd,9);else if(!IsWindowVisible(b.hwnd))ShowWindowAsync(b.hwnd,5);SetForegroundWindow(b.hwnd);}
   bool foreground=Native.GetForegroundWindow()==b.hwnd&&!IsIconic(b.hwnd)&&IsWindowVisible(b.hwnd);
   long baseline;bool physical=mouseHook!=IntPtr.Zero&&keyboardHook!=IntPtr.Zero&&completionInput.TryGetValue(Program.S(p,"completionId"),out baseline)&&inputSerial>baseline&&lastPhysical;
   return new Dictionary<string,object>{{"foreground",foreground},{"interactive",foreground},{"windowToken",b.token},{"clientId",b.client},{"userInput",physical}};
  }
  public static object Unbind(Dictionary<string,object> p){bindings.Remove(Program.S(p,"windowToken"));return new Dictionary<string,object>{{"removed",true}};}
  static IntPtr IconAt(IntPtr hwnd,int which) {IntPtr value;if(SendMessageTimeout(hwnd,0x7f,new IntPtr(which),IntPtr.Zero,2,100,out value)==IntPtr.Zero)return IntPtr.Zero;return value;}
  static bool SetIcon(IntPtr hwnd,int which,IntPtr icon) {IntPtr result;return SendMessageTimeout(hwnd,0x80,new IntPtr(which),icon,2,100,out result)!=IntPtr.Zero;}
  static bool ValidIcon(IntPtr icon) {if(icon==IntPtr.Zero)return false;IconInfo info;if(!GetIconInfo(icon,out info))return false;if(info.mask!=IntPtr.Zero)DeleteObject(info.mask);if(info.color!=IntPtr.Zero)DeleteObject(info.color);return true;}
  static IntPtr Compose(IntPtr original,long n) {
   using(var bitmap=new Bitmap(128,128,PixelFormat.Format32bppArgb))using(var g=Graphics.FromImage(bitmap))using(var icon=(Icon)Icon.FromHandle(original).Clone()) {
    g.Clear(Color.Transparent);g.SmoothingMode=SmoothingMode.AntiAlias;g.InterpolationMode=InterpolationMode.HighQualityBicubic;g.DrawIcon(icon,new Rectangle(0,0,128,128));
    string text=n.ToString(System.Globalization.CultureInfo.InvariantCulture);float width=text.Length==1?48:text.Length==2?68:86;var rect=new RectangleF(128-width,0,width,48);
    using(var path=new GraphicsPath()){path.AddArc(rect.Left,0,48,48,90,180);path.AddArc(rect.Right-48,0,48,48,270,180);path.CloseFigure();using(var brush=new SolidBrush(Color.FromArgb(237,48,67)))g.FillPath(brush,path);}
    using(var font=new Font("Segoe UI",text.Length>2?30:34,FontStyle.Bold,GraphicsUnit.Pixel))using(var format=new StringFormat{Alignment=StringAlignment.Center,LineAlignment=StringAlignment.Center})g.DrawString(text,font,Brushes.White,new RectangleF(rect.Left,-1,rect.Width,48),format);
    return bitmap.GetHicon();
   }
  }
  static void Release(Mark mark) {
   if(IsWindow(mark.hwnd)) {
    if(IconAt(mark.hwnd,1)==mark.big) {if(!ValidIcon(mark.originalBig)||!SetIcon(mark.hwnd,1,mark.originalBig))throw new Exception("BADGE_OWNER_CONFLICT");}
    if(IconAt(mark.hwnd,0)==mark.small) {if(!ValidIcon(mark.originalSmall)||!SetIcon(mark.hwnd,0,mark.originalSmall))throw new Exception("BADGE_OWNER_CONFLICT");}
   }
   if(mark.big!=IntPtr.Zero)DestroyIcon(mark.big);if(mark.small!=IntPtr.Zero)DestroyIcon(mark.small);
  }
  public static object Badge(Dictionary<string,object> p) {
   double requested=Program.D(p,"count");if(requested<0||requested>9007199254740991||requested!=Math.Floor(requested))throw new Exception("PROTOCOL_ERROR");
   count=(long)requested;if(count>999){foreach(var mark in marks.Values)Release(mark);marks.Clear();throw new Exception("BADGE_RENDER_LIMIT");}generation++;
   if(count==0){foreach(var mark in marks.Values)Release(mark);marks.Clear();return new Dictionary<string,object>{{"count",0},{"removed",true},{"generation",generation}};}
   int changed=0;
   foreach(var root in new List<Root>(roots.Values)) foreach(var hwnd in Windows(root)) {
    Mark previous;marks.TryGetValue(hwnd,out previous);IntPtr big=IconAt(hwnd,1),small=IconAt(hwnd,0);
    if(previous!=null){if(big==previous.big)big=previous.originalBig;if(small==previous.small)small=previous.originalSmall;}
    if(!ValidIcon(big))big=GetClassLongPtr(hwnd,-14);if(!ValidIcon(small))small=GetClassLongPtr(hwnd,-34);if(!ValidIcon(small))small=big;
    if(!ValidIcon(big)||!ValidIcon(small))continue;
    var mark=new Mark{hwnd=hwnd,originalBig=big,originalSmall=small,big=Compose(big,count),small=Compose(small,count)};
    if(!SetIcon(hwnd,1,mark.big)||!SetIcon(hwnd,0,mark.small)){Release(mark);throw new Exception("BADGE_OWNER_CONFLICT");}
    marks[hwnd]=mark;if(previous!=null){DestroyIcon(previous.big);DestroyIcon(previous.small);}changed++;
   }
   foreach(var hwnd in new List<IntPtr>(marks.Keys))if(!IsWindow(hwnd)){Release(marks[hwnd]);marks.Remove(hwnd);}
   if(changed==0)throw new Exception("BADGE_PLACEMENT_UNSUPPORTED");
   return new Dictionary<string,object>{{"count",count},{"windows",changed},{"placement","top-right"},{"backend","window-icon-composition"},{"generation",generation},{"acceptance","UNVERIFIED"}};
  }
  public static void ReleaseAll() {foreach(var mark in marks.Values)try{Release(mark);}catch{}marks.Clear();bindings.Clear();roots.Clear();completionInput.Clear();if(mouseHook!=IntPtr.Zero)UnhookWindowsHookEx(mouseHook);if(keyboardHook!=IntPtr.Zero)UnhookWindowsHookEx(keyboardHook);if(environmentHook!=IntPtr.Zero)UnhookWinEvent(environmentHook);mouseHook=keyboardHook=environmentHook=IntPtr.Zero;}
 }
}
