import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.112.1/build/three.module.js';
import Stats from 'https://cdn.jsdelivr.net/npm/three@0.112.1/examples/jsm/libs/stats.module.js';
// import {WEBGL} from 'https://cdn.jsdelivr.net/npm/three@0.112.1/examples/jsm/WebGL.js';


// var heyEvanDoYouWantTheStatsWindowVisible = true;

export const graphics = (function() {

  // function _GetImageData(image) {
  //   const canvas = document.createElement('canvas');
  //   canvas.width = image.width;
  //   canvas.height = image.height;

  //   const context = canvas.getContext( '2d' );
  //   context.drawImage(image, 0, 0);

  //   return context.getImageData(0, 0, image.width, image.height);
  // }

  // function _GetPixel(imagedata, x, y) {
  //   const position = (x + imagedata.width * y) * 4;
  //   const data = imagedata.data;
  //   return {
  //       r: data[position],
  //       g: data[position + 1],
  //       b: data[position + 2],
  //       a: data[position + 3]
  //   };
  // }

  class _Graphics {

    Initialize() {


      this._scene.background = new THREE.Color(0xaaaaaa);

      this._CreateLights();

      return true;
    }



    get Scene() {
      return this._scene;
    }

    get Camera() {
      return this._camera;
    }

    Render() {
      this.renderer.render(this._scene, this._camera);
      if (heyEvanDoYouWantTheStatsWindowVisible) this._stats.update();
    }
  }

  return {
    Graphics: _Graphics,
    // GetPixel: _GetPixel,
    // GetImageData: _GetImageData,
  };
})();
