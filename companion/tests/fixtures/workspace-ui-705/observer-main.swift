import Foundation
import Darwin

guard CommandLine.arguments.count==2 else{exit(40)}
do {let scene=try OwnedUI705Scene(CommandLine.arguments[1]);let observer=OwnedRunner705Observer(scene);try observer.start();withExtendedLifetime(observer){RunLoop.main.run()}}catch{FileHandle.standardError.write(Data("OWNED_UI_OBSERVER_REFUSED\n".utf8));exit(41)}
