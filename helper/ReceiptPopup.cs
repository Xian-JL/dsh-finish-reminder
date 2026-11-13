using System;
using System.Collections.Generic;
using System.Globalization;
using System.Windows;
using System.Windows.Automation;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Media.Effects;
using System.Windows.Shapes;
using System.Windows.Threading;

namespace DshFinishReminder {
  // Pure vector paper renderer. It owns visuals and input, never task/read-state decisions.
  class Popup : Window {
    const double Shadow=8,SliceH=36,Gap=6;
    public Canvas canvas=new Canvas {ClipToBounds=true};
    public IntPtr handle;
    public Action<string,string,int,bool> interaction;
    public Action<string,int> painted;
    public Action displayUnavailable;
    readonly bool preview;readonly bool? forcedContrast;
    Canvas paper;Geometry paperGeometry;Button returnButton,closeButton;
    TextBlock titleText,contextText,timeText,numberText,actionText;
    Border progressFill;Path paperPath;
    Dictionary<string,Brush> palette;
    string cardId="",state="",layoutKey="",pressedCard="",pressedAction="";int generation,pressedGeneration;
    bool physicalDown,hasPaper,ready,hovered,openingLocal,openingConfirmed,rebuilding,exiting,terminated;bool? reportedHover;
    long visualEpoch;double textScale=1,trackWidth,paperTop,paperWidth,paperHeight;
    DispatcherTimer entranceTimer,exitTimer,retryTimer;int paintRetries;
    readonly List<DispatcherTimer> timers=new List<DispatcherTimer>();
    public Popup():this(false,null){}
    public Popup(bool offscreen,bool? highContrast) {
      preview=offscreen;forcedContrast=highContrast;Title="DSH task receipt";WindowStyle=WindowStyle.None;
      ResizeMode=ResizeMode.NoResize;AllowsTransparency=true;Background=Brushes.Transparent;
      ShowInTaskbar=false;ShowActivated=false;Topmost=true;Focusable=false;Content=canvas;
      SourceInitialized+=delegate {
        handle=new WindowInteropHelper(this).Handle;
        Native.SetWindowLong(handle,-20,Native.GetWindowLong(handle,-20)|0x08000000|0x80);
        HwndSource.FromHwnd(handle).AddHook(Hook);
      };
      Closed+=delegate{terminated=true;hasPaper=false;ready=false;visualEpoch++;StopTimers();};
    }
    bool Contrast {get{return forcedContrast??SystemParameters.HighContrast;}}
    bool ReduceMotion {get{return preview||!SystemParameters.ClientAreaAnimation;}}
    bool Interactive {get{return !terminated&&(preview||IsVisible)&&hasPaper&&ready&&!openingLocal&&(state=="front"||state=="paused");}}
    IntPtr Hook(IntPtr hwnd,int msg,IntPtr w,IntPtr l,ref bool handled) {
      if(msg==0x21){handled=true;return new IntPtr(3);}
      if((msg==0x2e0||msg==0x1a)&&Program.environmentChanged!=null)Program.environmentChanged();
      if(msg==0x84) {
        int bits=unchecked((int)l.ToInt64());Point p=PointFromScreen(new Point((short)(bits&0xffff),(short)((bits>>16)&0xffff)));
        if(!hasPaper||paperGeometry==null||!paperGeometry.FillContains(new Point(p.X-Shadow,p.Y-paperTop))){handled=true;return new IntPtr(-1);}
      }
      return IntPtr.Zero;
    }
    static Brush BrushOf(string value){var b=new SolidColorBrush((Color)ColorConverter.ConvertFromString(value));b.Freeze();return b;}
    void SetPalette(bool dark){
      palette=new Dictionary<string,Brush>();string[] colors=dark?ReceiptTheme.Dark:ReceiptTheme.Light;
      for(int i=0;i<ReceiptTheme.Names.Length;i++)palette[ReceiptTheme.Names[i]]=BrushOf(colors[i]);
      if(Contrast){foreach(string name in ReceiptTheme.Names)palette[name]=name=="paper"?SystemColors.WindowBrush:name=="focusInk"?SystemColors.HighlightBrush:SystemColors.WindowTextBrush;}
    }
    Brush Ink(string outcome){return palette[outcome=="ended"?"endedInk":outcome=="error"?"errorInk":outcome=="unknown"?"secondaryInk":"attentionInk"];}
    static string Compact(string outcome){switch(outcome){case "ended":return "已结束";case "error":return "失败结束";case "stopped":return "已停止";case "interrupted":return "已中断";case "limited":return "达到限制";case "blocked":return "受阻结束";default:return "原因未知";}}
    static string ErrorText(string code){switch(code){case "WINDOW_BINDING_AMBIGUOUS":return "窗口绑定不明确";case "FOREGROUND_DENIED":return "无法前置窗口";case "NAVIGATION_TIMEOUT":return "返回超时";case "NAVIGATION_CANCELLED":return "返回已取消";case "TARGET_GONE":return "对话不存在";case "TARGET_ARCHIVED":return "对话已归档";case "ACCESS_DENIED":return "无访问权限";default:return code;}}
    public static Geometry PaperGeometry(double w,double h,bool simple){
      if(simple)return new RectangleGeometry(new Rect(0,0,w,h));
      var g=new StreamGeometry();using(var c=g.Open()){
        c.BeginFigure(new Point(8,0),true,true);c.LineTo(new Point(w-8,0),true,false);c.QuadraticBezierTo(new Point(w,0),new Point(w,8),true,false);
        c.LineTo(new Point(w,h-4),true,false);
        for(double x=w;x>0;x-=10){c.LineTo(new Point(Math.Max(0,x-5),h),true,false);c.LineTo(new Point(Math.Max(0,x-10),h-4),true,false);}
        c.LineTo(new Point(0,8),true,false);c.QuadraticBezierTo(new Point(0,0),new Point(8,0),true,false);
      }g.Freeze();return g;
    }
    static void Place(UIElement element,Canvas parent,double x,double y){Canvas.SetLeft(element,x);Canvas.SetTop(element,y);parent.Children.Add(element);}
    TextBlock Text(string value,double font,double width,Brush ink){return new TextBlock{Text=value,FontSize=font,Width=Math.Max(1,width),Foreground=ink,FontFamily=SystemFonts.MessageFontFamily,TextTrimming=TextTrimming.CharacterEllipsis,TextWrapping=TextWrapping.NoWrap};}
    ControlTemplate ButtonTemplate(bool close){
      var template=new ControlTemplate(typeof(Button));var border=new FrameworkElementFactory(typeof(Border),"Frame");
      border.SetValue(Border.BackgroundProperty,Brushes.Transparent);border.SetValue(Border.BorderBrushProperty,Brushes.Transparent);
      border.SetValue(Border.BorderThicknessProperty,new Thickness(1));border.SetValue(Border.CornerRadiusProperty,new CornerRadius(close?4:8));
      var content=new FrameworkElementFactory(typeof(ContentPresenter));content.SetValue(FrameworkElement.HorizontalAlignmentProperty,HorizontalAlignment.Stretch);
      content.SetValue(FrameworkElement.VerticalAlignmentProperty,VerticalAlignment.Stretch);border.AppendChild(content);template.VisualTree=border;
      var focus=new Trigger{Property=UIElement.IsKeyboardFocusedProperty,Value=true};focus.Setters.Add(new Setter(Border.BorderBrushProperty,palette["focusInk"],"Frame"));template.Triggers.Add(focus);
      if(close){var hover=new Trigger{Property=UIElement.IsMouseOverProperty,Value=true};hover.Setters.Add(new Setter(Border.BorderBrushProperty,palette["secondaryInk"],"Frame"));template.Triggers.Add(hover);}
      return template;
    }
    public void Draw(Dictionary<string,object> front,List<Dictionary<string,object>> previews,int queued,bool dark,Dictionary<string,object> geometry){
      string id=Program.S(front,"cardId");int gen=Program.I(front,"displayGeneration");string nextState=Program.S(front,"state");
      string key=dark+"|"+Contrast+"|"+Program.D(geometry,"width")+"|"+Program.D(geometry,"height")+"|"+Program.D(geometry,"cardHeight")+"|"+Program.D(geometry,"textScale")+"|"+Program.D(geometry,"previews")+"|"+Program.D(geometry,"scale")+"|"+Program.D(geometry,"left")+"|"+Program.D(geometry,"top")+"|"+queued;
      foreach(var p in previews)key+="|"+Program.S(p,"cardId")+"|"+Program.S(p,"displayTitle")+"|"+Program.S(p,"outcome");
      key+="|"+Program.S(front,"displayTitle")+"|"+Program.S(front,"outcome");
      bool fresh=!hasPaper||id!=cardId,newToken=fresh||gen!=generation;
      if(newToken){ready=preview;reportedHover=null;physicalDown=false;pressedCard="";openingLocal=false;openingConfirmed=false;}
      cardId=id;generation=gen;state=nextState;
      if(fresh||newToken||key!=layoutKey){
        visualEpoch++;StopTimers();exiting=false;rebuilding=true;SetPalette(dark);
        Build(front,previews,queued,geometry);layoutKey=key;hasPaper=true;rebuilding=false;
        if(preview){canvas.Measure(new Size(Width,Height));canvas.Arrange(new Rect(0,0,Width,Height));canvas.UpdateLayout();}
        else Position(geometry);
        if(!preview&&state=="painting"&&!ready)BeginPaint(fresh);
      }
      Update(front);if(preview){canvas.Measure(new Size(Width,Height));canvas.Arrange(new Rect(0,0,Width,Height));canvas.UpdateLayout();}else if(ready)SyncPointer(false);
    }
    void Build(Dictionary<string,object> front,List<Dictionary<string,object>> previews,int queued,Dictionary<string,object> geometry){
      if(returnButton!=null)returnButton.IsEnabled=false;if(closeButton!=null)closeButton.IsEnabled=false;
      Width=Program.D(geometry,"width");Height=Program.D(geometry,"height");canvas.Width=Width;canvas.Height=Height;
      textScale=Program.D(geometry,"textScale");paperWidth=Program.D(geometry,"cardWidth");paperHeight=Program.D(geometry,"cardHeight");
      int k=Program.I(geometry,"previews");paperTop=Shadow+k*(SliceH+Gap);trackWidth=paperWidth-24;
      canvas.BeginAnimation(UIElement.OpacityProperty,null);canvas.Opacity=1;canvas.RenderTransform=Transform.Identity;canvas.Children.Clear();
      for(int layer=k;layer>=1;layer--)BuildPreview(previews[layer-1],layer,k,queued);
      paperGeometry=PaperGeometry(paperWidth,paperHeight,Contrast);
      paperPath=new Path{Data=paperGeometry,Fill=palette["paper"],Stroke=palette["perforation"],StrokeThickness=1,IsHitTestVisible=false};
      if(!Contrast)paperPath.Effect=new DropShadowEffect{Color=Colors.Black,BlurRadius=9,ShadowDepth=1.5,Opacity=0.24};
      Place(paperPath,canvas,Shadow,paperTop);
      paper=new Canvas{Width=paperWidth,Height=paperHeight,Background=Brushes.Transparent,Clip=paperGeometry};Place(paper,canvas,Shadow,paperTop);
      var content=new Canvas{Width=paperWidth,Height=paperHeight};
      returnButton=new Button{Content=content,Width=paperWidth,Height=paperHeight,Padding=new Thickness(0),BorderThickness=new Thickness(0),Template=ButtonTemplate(false),Background=Brushes.Transparent};
      Place(returnButton,paper,0,0);Wire(returnButton,"return");
      double closeSize=24*textScale;
      closeButton=new Button{Content=new TextBlock{Text="×",FontSize=17*textScale,Foreground=palette["secondaryInk"],HorizontalAlignment=HorizontalAlignment.Center,VerticalAlignment=VerticalAlignment.Center},Width=closeSize,Height=closeSize,Padding=new Thickness(0),Template=ButtonTemplate(true)};
      AutomationProperties.SetName(closeButton,"关闭此回执");Place(closeButton,paper,paperWidth-closeSize-8,5*textScale);Wire(closeButton,"close");
      var stampText=Text(Compact(Program.S(front,"outcome")),10*textScale,110*textScale,Ink(Program.S(front,"outcome")));stampText.Width=Double.NaN;stampText.FontWeight=FontWeights.SemiBold;
      stampText.Measure(new Size(Double.PositiveInfinity,Double.PositiveInfinity));
      double stampW=Math.Min(paperWidth-closeSize-40,stampText.DesiredSize.Width+12*textScale);
      var stamp=new Border{Width=stampW,Height=18*textScale,BorderThickness=new Thickness(1),BorderBrush=Ink(Program.S(front,"outcome")),CornerRadius=new CornerRadius(3),Padding=new Thickness(5*textScale,0,5*textScale,0),Child=stampText};
      double stampX=paperWidth-8-closeSize-8-stampW;Place(stamp,content,stampX,8*textScale);
      Place(Text("DSH · 任务回执",10*textScale,stampX-24,palette["secondaryInk"]),content,12,10*textScale);
      titleText=Text(Program.S(front,"displayTitle"),14*textScale,paperWidth-24,palette["ink"]);titleText.FontWeight=FontWeights.SemiBold;
      titleText.TextWrapping=TextWrapping.Wrap;titleText.LineHeight=18*textScale;titleText.MaxHeight=36*textScale;Place(titleText,content,12,31*textScale);
      contextText=Text("",11*textScale,paperWidth-24,palette["secondaryInk"]);Place(contextText,content,12,72*textScale);
      timeText=Text("",11*textScale,paperWidth-24,palette["secondaryInk"]);Place(timeText,content,12,88*textScale);
      var perforation=new Line{X1=12,X2=paperWidth-12,Y1=106*textScale,Y2=106*textScale,Stroke=palette["perforation"],StrokeThickness=1,StrokeDashArray=new DoubleCollection{3,3},IsHitTestVisible=false};content.Children.Add(perforation);
      double actionWidth=Math.Min(paperWidth-24,110*textScale);
      numberText=Text("",10*textScale,Math.Max(40,paperWidth-actionWidth-36),palette["secondaryInk"]);numberText.FontFamily=new FontFamily("Consolas, Segoe UI");Place(numberText,content,12,115*textScale);
      actionText=Text("返回原对话",11*textScale,actionWidth,palette["ink"]);actionText.TextAlignment=TextAlignment.Right;Place(actionText,content,paperWidth-actionWidth-12,114*textScale);
      var track=new Border{Width=trackWidth,Height=2,Background=palette["perforation"],Opacity=0.38,IsHitTestVisible=false};Place(track,content,12,137*textScale);
      progressFill=new Border{Width=0,Height=2,Background=Ink(Program.S(front,"outcome")),IsHitTestVisible=false};Place(progressFill,content,12,137*textScale);
      paper.MouseEnter+=delegate{if(!rebuilding)SyncPointer(false);};paper.MouseLeave+=delegate{if(!rebuilding)SyncPointer(false);};
    }
    void BuildPreview(Dictionary<string,object> p,int layer,int k,int queued){
      double width=paperWidth-8*layer,top=Shadow+(k-layer)*(SliceH+Gap);
      var previewPaper=new Canvas{Width=width,Height=SliceH,IsHitTestVisible=false};
      previewPaper.Children.Add(new Path{Data=PaperGeometry(width,SliceH,Contrast),Fill=palette["paper"],Stroke=palette["perforation"],StrokeThickness=1});
      Place(Text(Compact(Program.S(p,"outcome")),10,52,Ink(Program.S(p,"outcome"))),previewPaper,10,8);
      Place(Text(Program.S(p,"displayTitle"),11,Math.Max(40,width-150),palette["secondaryInk"]),previewPaper,68,7);
      if(layer==2&&queued>3)Place(Text("另有"+(queued-3)+"张",10,70,palette["secondaryInk"]),previewPaper,width-76,8);
      Place(previewPaper,canvas,Shadow+4*layer,top);
    }
    void Wire(Button button,string target){
      string observedId=cardId;int observedGeneration=generation;
      button.PreviewMouseLeftButtonDown+=delegate(object sender,MouseButtonEventArgs e){pressedCard=cardId;pressedGeneration=generation;pressedAction=target;physicalDown=HumanInput()&&Interactive&&observedId==cardId&&observedGeneration==generation;};
      button.PreviewMouseLeftButtonUp+=delegate(object sender,MouseButtonEventArgs e){
        bool accepted=physicalDown&&HumanInput()&&Interactive&&pressedCard==cardId&&pressedGeneration==generation&&pressedAction==target;
        physicalDown=false;pressedCard="";e.Handled=true;if(accepted)Activate(target);
      };
      button.Click+=delegate{if(button.IsEnabled&&observedId==cardId&&observedGeneration==generation&&Interactive&&Desktop.AccessibleInput(cardId))Activate(target);};
    }
    bool HumanInput(){Native.InputSource source;return Native.GetCurrentInputMessageSource(out source)&&source.origin==1;}
    void Activate(string target){
      if(!Interactive)return;
      if(target=="return"){openingLocal=true;returnButton.IsEnabled=false;closeButton.IsEnabled=false;actionText.Text="正在返回…";}
      if(interaction!=null)interaction(target=="close"?"dismiss":"click",cardId,generation,false);
    }
    static string Duration(Dictionary<string,object> f){object raw;if(!f.TryGetValue("durationMs",out raw)||raw==null)return "";long s=(long)Math.Floor(Convert.ToDouble(raw)/1000);return s<1?"不足1秒":s<60?s+"秒":s<3600?(s/60)+"分":s<86400?(s/3600)+"小时":(s/86400)+"天";}
    void Update(Dictionary<string,object> front){
      if(returnButton==null)return;
      string error=Program.S(front,"error");if(state=="opening")openingConfirmed=true;
      if(state!="opening"&&(openingConfirmed||error.Length>0)){openingLocal=false;openingConfirmed=false;}
      bool opening=state=="opening"||openingLocal;
      string workspace=Program.S(front,"workspaceTitle"),duration=Duration(front);
      contextText.Text=(workspace.Length>0?workspace:"未记录工作区")+(duration.Length>0?" · 历时"+duration:" · 历时未知");
      string ended=DateTimeOffset.FromUnixTimeMilliseconds((long)Program.D(front,"endedAt")).LocalDateTime.ToString("MM-dd HH:mm:ss");
      timeText.Text=error.Length>0?"返回失败："+ErrorText(error):ended+(Program.B(front,"currentlyRunning")?" · 新任务运行中":"");
      timeText.Foreground=palette[error.Length>0?"errorInk":"secondaryInk"];
      long number=(long)Program.D(front,"receiptNumber");string numberLabel="回执 #"+number.ToString("D4",CultureInfo.InvariantCulture);
      numberText.Text=textScale>1.4?"#"+number.ToString("D4",CultureInfo.InvariantCulture):numberLabel;numberText.ToolTip=numberLabel;
      actionText.Text=opening?"正在返回…":error.Length>0?"重试返回":"返回原对话";
      returnButton.IsEnabled=Interactive;closeButton.IsEnabled=Interactive;
      string description=Program.Outcome(Program.S(front,"outcome"))+"，"+Program.S(front,"displayTitle")+"，"+contextText.Text+"，"+ended+(Program.B(front,"currentlyRunning")?"，当前有新任务运行":"")+"，"+numberLabel;
      AutomationProperties.SetName(returnButton,description+"，返回原对话");returnButton.ToolTip=description;
      double remaining=Program.D(front,"remainingFrontMs"),spent=Math.Max(0,Math.Min(1,1-remaining/10000));
      progressFill.BeginAnimation(FrameworkElement.WidthProperty,null);progressFill.Width=trackWidth*spent;
      if(state=="front"&&!opening&&!preview){var animation=new DoubleAnimation(trackWidth,TimeSpan.FromMilliseconds(Math.Max(1,remaining)));progressFill.BeginAnimation(FrameworkElement.WidthProperty,animation);}
    }
    void Position(Dictionary<string,object> geometry){
      double dpiScale=Program.D(geometry,"scale");Left=Program.D(geometry,"left")/dpiScale;Top=Program.D(geometry,"top")/dpiScale;
      new WindowInteropHelper(this).EnsureHandle();
      Native.SetWindowPos(handle,new IntPtr(-1),Program.I(geometry,"left"),Program.I(geometry,"top"),(int)Math.Round(Width*dpiScale),(int)Math.Round(Height*dpiScale),0x0010);
      if(!IsVisible)Show();
    }
    void BeginPaint(bool fresh){
      long epoch=visualEpoch;paintRetries=0;
      if(fresh&&!ReduceMotion){
        canvas.Opacity=0.86;var translate=new TranslateTransform(0,8);canvas.RenderTransform=translate;
        canvas.BeginAnimation(UIElement.OpacityProperty,new DoubleAnimation(1,TimeSpan.FromMilliseconds(160)));
        translate.BeginAnimation(TranslateTransform.YProperty,new DoubleAnimation(0,TimeSpan.FromMilliseconds(160)){EasingFunction=new CubicEase{EasingMode=EasingMode.EaseOut}});
        entranceTimer=Once(160,delegate{CompletePaint(epoch);});
      }else Dispatcher.BeginInvoke(DispatcherPriority.ContextIdle,new Action(delegate{CompletePaint(epoch);}));
    }
    void CompletePaint(long epoch){
      if(epoch!=visualEpoch||!hasPaper||!IsVisible||state!="painting"||ready)return;
      canvas.BeginAnimation(UIElement.OpacityProperty,null);canvas.Opacity=1;canvas.RenderTransform=Transform.Identity;canvas.UpdateLayout();
      if(Native.DwmFlush()!=0){if(++paintRetries<=3)retryTimer=Once(50,delegate{CompletePaint(epoch);});else if(displayUnavailable!=null)displayUnavailable();return;}
      ready=true;if(painted!=null)painted(cardId,generation);SyncPointer(true);
    }
    void SyncPointer(bool force){
      if(preview||!ready||!hasPaper||!IsVisible)return;
      Native.Point cursor;bool on=false;
      if(Native.GetCursorPos(out cursor)){Point p=PointFromScreen(new Point(cursor.x,cursor.y));on=paperGeometry.FillContains(new Point(p.X-Shadow,p.Y-paperTop));}
      hovered=on;
      if(force||reportedHover==null||reportedHover.Value!=on){reportedHover=on;if(interaction!=null)interaction("hover",cardId,generation,on);}
    }
    DispatcherTimer Once(int ms,Action action){
      var timer=new DispatcherTimer(DispatcherPriority.Render){Interval=TimeSpan.FromMilliseconds(ms)};
      timer.Tick+=delegate{timer.Stop();timers.Remove(timer);action();};timers.Add(timer);timer.Start();return timer;
    }
    void StopTimers(){foreach(var timer in timers)timer.Stop();timers.Clear();entranceTimer=exitTimer=retryTimer=null;}
    public void HideImmediate(){visualEpoch++;StopTimers();hasPaper=false;ready=false;exiting=false;openingLocal=false;physicalDown=false;Hide();}
    public void Leave(){
      if(exiting)return;if(!hasPaper||!IsVisible||ReduceMotion){HideImmediate();return;}
      long epoch=++visualEpoch;StopTimers();hasPaper=false;ready=false;exiting=true;returnButton.IsEnabled=false;closeButton.IsEnabled=false;
      canvas.Children.Clear();var outline=new Path{Data=paperGeometry,Stroke=palette["perforation"],StrokeThickness=1,IsHitTestVisible=false};Place(outline,canvas,Shadow,paperTop);
      var translate=new TranslateTransform();canvas.RenderTransform=translate;translate.BeginAnimation(TranslateTransform.XProperty,new DoubleAnimation(18,TimeSpan.FromMilliseconds(110)));
      canvas.BeginAnimation(UIElement.OpacityProperty,new DoubleAnimation(0,TimeSpan.FromMilliseconds(110)));
      exitTimer=Once(110,delegate{if(epoch==visualEpoch)HideImmediate();});
    }
    internal Dictionary<string,object> PreviewAudit(){
      if(!preview)throw new InvalidOperationException();
      return new Dictionary<string,object>{{"receiptLabel",numberText.Text},{"fullReceiptLabel",numberText.ToolTip.ToString()},
        {"context",contextText.Text},{"time",timeText.Text},{"titleHeight",titleText.ActualHeight},{"titleLimit",36*textScale},
        {"printWidth",progressFill.ActualWidth},{"trackWidth",trackWidth},{"action",actionText.Text},
        {"returnEnabled",returnButton.IsEnabled},{"closeEnabled",closeButton.IsEnabled},
        {"actualCornerHit",paperGeometry.FillContains(new Point(0,0))}};
    }
  }
  static class ReceiptLayout {
    public static double SystemTextScale(){try{object value=Microsoft.Win32.Registry.GetValue(@"HKEY_CURRENT_USER\Software\Microsoft\Accessibility","TextScaleFactor",100);return Math.Max(1,Convert.ToDouble(value)/100);}catch{return 1;}}
    public static Dictionary<string,object> Calculate(double left,double top,double right,double bottom,double dpi,int previews,double textScale){
      if(Double.IsNaN(left+top+right+bottom+dpi+textScale)||Double.IsInfinity(left+top+right+bottom+dpi+textScale)||dpi<96||dpi>384||textScale<1||textScale>2.25)throw new Exception("DISPLAY_UNAVAILABLE");
      double scale=dpi/96,width=Math.Min(352,(right-left)/scale-48),height=Math.Ceiling(144*textScale);int k=Math.Max(0,Math.Min(2,previews));
      while(k>0&&(height+16+k*42+32)*scale>bottom-top)k--;
      if(width<300||(height+16+32)*scale>bottom-top)throw new Exception("DISPLAY_UNAVAILABLE");
      return new Dictionary<string,object>{{"left",Math.Round(right-(16+width+16)*scale)},{"top",Math.Round(bottom-(16+height+16+k*42)*scale)},
        {"width",width+16},{"height",height+16+k*42},{"cardWidth",width},{"cardHeight",height},{"previews",k},{"scale",scale},{"textScale",textScale}};
    }
  }
}
