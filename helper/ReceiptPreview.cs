// Development-only invisible rendering. Does not start Program.Main, pipes, input hooks or a desktop window.
using System;using System.Collections;using System.Collections.Generic;using System.IO;using System.Web.Script.Serialization;
using System.Windows;using System.Windows.Media;using System.Windows.Media.Imaging;
namespace DshFinishReminder {
  static class ReceiptPreview {
    [STAThread]static int Main(string[] args){
      try{
        if(args.Length!=2)return 2;
        var json=new JavaScriptSerializer{MaxJsonLength=1048576};var cases=(object[])json.DeserializeObject(File.ReadAllText(args[0]));
        Directory.CreateDirectory(args[1]);RenderOptions.ProcessRenderMode=System.Windows.Interop.RenderMode.SoftwareOnly;
        var app=new Application{ShutdownMode=ShutdownMode.OnExplicitShutdown};var results=new List<object>();
        foreach(object raw in cases){
          var c=(Dictionary<string,object>)raw;string name=(string)c["name"];
          if(!System.Text.RegularExpressions.Regex.IsMatch(name,"^[a-z0-9-]+$"))return 3;
          var safe=(Dictionary<string,object>)c["safe"];
          var geometry=ReceiptLayout.Calculate(Program.D(safe,"left"),Program.D(safe,"top"),Program.D(safe,"right"),Program.D(safe,"bottom"),Program.D(c,"dpi"),Program.I(c,"previewCount"),Program.D(c,"textScale"));
          var popup=new Popup(true,Program.B(c,"highContrast"));var previews=new List<Dictionary<string,object>>();
          foreach(object p in (object[])c["previews"])previews.Add((Dictionary<string,object>)p);
          popup.Draw((Dictionary<string,object>)c["front"],previews,Program.I(c,"queued"),Program.B(c,"dark"),geometry);
          double scale=Program.D(geometry,"scale");var bitmap=new RenderTargetBitmap((int)Math.Ceiling(popup.Width*scale),(int)Math.Ceiling(popup.Height*scale),96*scale,96*scale,PixelFormats.Pbgra32);
          bitmap.Render(popup.canvas);var encoder=new PngBitmapEncoder();encoder.Frames.Add(BitmapFrame.Create(bitmap));
          using(var file=File.Create(Path.Combine(args[1],name+".png")))encoder.Save(file);
          var paper=Popup.PaperGeometry(352,144,false);
          results.Add(new{name=name,geometry=geometry,topCornerExcluded=!paper.FillContains(new Point(0,0)),paperCenterIncluded=paper.FillContains(new Point(100,80)),toothGapExcluded=!paper.FillContains(new Point(349,143)),audit=popup.PreviewAudit(),offscreen=true});
          popup.Close();
        }
        File.WriteAllText(Path.Combine(args[1],"metrics.json"),json.Serialize(results));app.Shutdown();Console.WriteLine("OFFSCREEN_RENDER_PASS");return 0;
      }catch(Exception e){Console.Error.WriteLine(e.GetType().Name+": "+e.Message);return 1;}
    }
  }
}
