import * as Map from '../lib/map';
import * as Quality from './quality';
import * as Time from '../lib/time';
import * as Ratings from './ratings';
import * as Controls from '../lib/controls';
import config from '../config';

import nanoajax = require('nanoajax');

interface TimedMarker {
  marker: L.Marker,
  time: number
};

export let surveyData = {};

export let surveys = {
  quality: Quality
};

let activeSurveys: string[] = [];

// Store the selected parts to the survey
let surveyParts = {};

// Stores the currently active layers and parts
let surveyLayers  = {};

let surveyControls = {};

// Store the requested areas
let requestedAreas = {};

let allSurveysButton: HTMLElement;


/**
 * Returns the Leaflet LatLng object for a given survey
 *
 * @param {Object} survey Survey to create the latlng for
 *
 * @returns {LatLng} LatLng for given survey
 */
let pointLatlng = (survey: Survey) => {
  return L.latLng([survey.location._wgs84[1], survey.location._wgs84[0]]);
};

let surveyScore = (surveyType: string, survey: Survey): number => {
  let total: number = 0;
  let items: number;
  let score: number;

  if (surveyParts[surveyType] instanceof Array
      && (items = surveyParts[surveyType].length) !== 0) {
    surveyParts[surveyType].forEach((part: string) => {
      if (typeof (score = surveys[surveyType].parts[part].score(survey)) === 'number') {
        total += score;
      } else {
        items--;
      }
    });
    if (items) {
      return Math.round(total / items);
    }
  }
}

/**
 * Generates the color for the given survey based off the survey type,
 * survey time and survey result.
 *
 * @param {string} surveyType Type of survey
 * @param {Survey} survey Survey to create the color for
 *
 * @returns {HSLColor} CSS color string, in HSL format
 */
let pointColor = (surveyType: string, survey: Survey): HSLColor | false => {
  var score = 0;
  var items = 0;
  var currentTime = (new Date()).getTime();
  var h, s, l, o = 1;
  var value;
  let color;

  // Determine color based on the selected survey parts
  switch (surveyParts[surveyType].length) {
    case 0:
      return;
    case 1:
      // Single survey part active, so get color from survey part
      if ((color = surveys[surveyType].parts[surveyParts[surveyType][0]].color(survey))) {
        [h, s, l] = color;
      }
      break;
    default:
      if ((color = Ratings.getColor(surveyScore(surveyType, survey)))) {
        [h, s, l] = color;
      }
      break;
  }

  // grey it based on the halflife
  if (Time.selectedTimeType === 'decaying') {
    // Get the halflife value
    let decay = Time.getDecayAmount(currentTime - survey.timestamp._epoch);

    // Adjust saturation and lightness based of the diff;
    if (config.decaySaturation) {
      s  = Math.round(s - ((s - config.expiredSaturation) * decay));
    }
    if (config.decayLightness) {
      l  = Math.round(l - ((l - config.expiredLightness) * decay));
    }
    if (config.decayOpacity) {
      o = 1 - decay;
    }
  }

  if (typeof h === 'undefined') {
    return false;
  } else {
    return [h, s, l, o];
  }
};

/**
 * Creates a set of buttons for selecting the surveys to show on the map
 * and appends them into the given HTML Element.
 *
 * @aparam {HTMLElement} element Element to append buttons into
 */
export function createSurveyButtons(parentElement: HTMLElement) {
  parentElement.classList.add('surveys');
  let buttons, parts;

  // Add listenser to map
  Map.addListener(reloadData);

  // Add listener to time
  Time.addListener(redrawAllActive);

  // Add listener to ratings
  Ratings.addListener(redrawAllActive);

  parentElement.appendChild((buttons = document.createElement('div')));
  parentElement.appendChild((parts = document.createElement('div')));

  // Add all survey button
  allSurveysButton = document.createElement('button');
  buttons.appendChild(allSurveysButton);
  allSurveysButton.innerHTML = 'All';
  allSurveysButton.addEventListener('click', toggleSurvey.bind(null, false));

  // Add survey buttons to the section div
  Object.keys(surveys).forEach((s) => {
    let survey = surveys[s];
    surveyParts[s] = [];
    let button = document.createElement('button');
    buttons.appendChild(button);
    button.innerHTML = survey.label;
    button.addEventListener('click', toggleSurvey.bind(null, s));

    let pbuttons = Controls.addControlSection(survey.label, parentElement);
    pbuttons.style.display = 'none';
    let pdiv;
    pbuttons.appendChild((pdiv = document.createElement('div')));
    let pAllButton = document.createElement('button');
    pdiv.appendChild(pAllButton);
    pAllButton.innerHTML = 'All';
    pAllButton.addEventListener('click', toggleSurveyPart.bind(null, s, undefined));

    surveyControls[s] = {
      button: button,
      allButton: pAllButton,
      partSection: pbuttons,
      partButtons: {}
    };

    Object.keys(survey.parts).forEach((p) => {
      let pbutton = document.createElement('button');
      surveyControls[s].partButtons[p] = pbutton;
      pdiv.appendChild(pbutton);
      pbutton.innerHTML = survey.parts[p].label;
      pbutton.addEventListener('click', toggleSurveyPart.bind(null, s, p));
    });
  });
};

/**
 * Adds new survey data to the survey store
 *
 * @param {string} type String identifier of survey type
 * @param {Array} data Array of data to add to object
 */
export function addSurveyData(type: string, data: Survey[]) {
  if (typeof surveyData[type] !== 'object') {
    surveyData[type] = {};
  }

  data.forEach((survey) => {
    surveyData[type][survey._id['$oid']] = survey;
  });
};

/**
 * Toggles one or all of the surveys.
 *
 * @param {string} survey identifier of the survey to toggle
 *
 * @returns {undefined}
 */
export function toggleSurvey(survey?: string) {
  let index;
  let surveyKeys = Object.keys(surveys);

  if (survey) {
    if (typeof surveys[survey] !== 'undefined') {
      if ((index = activeSurveys.indexOf(survey)) !== -1) {
        // Disable
        activeSurveys.splice(index, 1);
        allSurveysButton.classList.remove('selected');
        if (surveyControls[survey].button) {
          surveyControls[survey].button.classList.remove('selected');
        }
        // Hide survey layer if created
        if (typeof surveyLayers[survey] !== 'undefined') {
          if (Map.map.hasLayer(surveyLayers[survey])) {
            Map.map.removeLayer(surveyLayers[survey]);
          }
        }
        // Hide parts layer
        surveyControls[survey].partSection.style.display = 'none';
      } else {
        // Enable
        activeSurveys.push(survey);
        if (surveyKeys.length === activeSurveys.length) {
          allSurveysButton.classList.add('selected');
        }

        if (surveyControls[survey].button) {
          surveyControls[survey].button.classList.add('selected');
        }
        // Show survey layer if created
        if (typeof surveyLayers[survey] !== 'undefined') {
          if (!Map.map.hasLayer(surveyLayers[survey])) {
            Map.map.addLayer(surveyLayers[survey]);
          }
        }
        // Show parts layer
        surveyControls[survey].partSection.style.display = '';

        reloadData(survey);
        //redrawSurveyData(survey);
      }
    }
  } else {
    if (activeSurveys.length === 0 || surveyKeys.length !== activeSurveys.length) {
      // Toggle all non-active surveys
      surveyKeys.forEach((survey) => {
        if (activeSurveys.indexOf(survey) === -1) {
          toggleSurvey(survey);
        }
      });
      allSurveysButton.classList.add('selected');
    } else {
      // Toggle all surveys
      surveyKeys.forEach((survey) => {
          toggleSurvey(survey);
      });
      allSurveysButton.classList.remove('selected');
    }
  }
};

/**
 * Toggles one or all of the survey parts.
 *
 * @param {string} survey identifier of the survey
 * @param {string} part identifier of the survey part to toggle
 *
 * @returns {undefined}
 */
export function toggleSurveyPart(survey: string, part?: string) {
  let index;

  if (typeof surveys[survey] !== 'undefined') {
    let partKeys = Object.keys(surveys[survey].parts);
    if (part) {
      if (typeof surveys[survey].parts[part] !== 'undefined') {
        if (typeof surveyParts[survey] === 'undefined') {
          surveyParts[survey] = [];
        }
        if ((index = surveyParts[survey].indexOf(part)) !== -1) {
          // Disable
          surveyParts[survey].splice(index, 1);
          surveyControls[survey].allButton.classList.remove('selected');
          if (surveyControls[survey].partButtons[part]) {
            surveyControls[survey].partButtons[part].classList.remove('selected');
          }
        } else {
          // Enable
          surveyParts[survey].push(part);
          if (partKeys.length === surveyParts[survey].length) {
            surveyControls[survey].allButton.classList.add('selected');
          }

          if (surveyControls[survey].partButtons[part]) {
            surveyControls[survey].partButtons[part].classList.add('selected');
          }
        }
      }
    } else {
      if (surveyParts[survey].length === 0 || partKeys.length !== surveyParts[survey].length) {
        // Toggle all non-active surveys
        partKeys.forEach((p) => {
          surveyControls[survey].partButtons[p].classList.add('selected');
        });
        surveyParts[survey] = partKeys;
        surveyControls[survey].allButton.classList.add('selected');
      } else {
        // Toggle all surveys
        partKeys.forEach((p) => {
          surveyControls[survey].partButtons[p].classList.remove('selected');
        });
        surveyParts[survey] = [];
        surveyControls[survey].allButton.classList.remove('selected');
      }
    }

    if (activeSurveys.indexOf(survey) !== -1) {
      redrawSurveyData(survey);
    }
  }
};

/**
 * Checks that the survey data currently covers the
 * map and updates if required
 *
 * @param {string} survey Check only a specific survey
 *
 * @returns {udefined}
 */
export function reloadData(survey?: string) {
  var toFetch: string[] = [];

  if (typeof survey === 'string' && typeof surveys[survey] === 'undefined') {
    throw new Error(`Unknown survey ${survey}`);
  }

  // Get the bounds of the map
  var bounds = Map.map.getBounds();

  var getParams = {
    ne: bounds.getNorth() + ',' + bounds.getEast(),
    sw: bounds.getSouth() + ',' + bounds.getWest()
  };

  var checkPreviousLoads = (survey: string) => {
    if (typeof requestedAreas[survey] !== 'undefined') {
      if (typeof (requestedAreas[survey].find((area: L.LatLngBounds) => {
        if (area.contains(bounds)) {
          return true;
        }
      })) === 'undefined') {
        toFetch.push(survey);
      }
    } else {
      toFetch.push(survey);
    }
  };

  // Check if previous requests for the given data contain the current bounds
  if (typeof survey === 'string') {
    checkPreviousLoads(survey);
  } else {
    activeSurveys.forEach(checkPreviousLoads);
  }

  // Request the data
  toFetch.forEach((survey) => {
    /*es6 var params = {
      ...getParams,
      ...surveys[survey].getParams
    };*/
    var params = Object.assign({}, getParams, surveys[survey].getParams);

    // Build the get parameters
    let get: any = [];
    Object.keys(params).forEach((param) => {
      get.push(param + '=' + encodeURIComponent(params[param]));
    });
    if (get.length) {
      get = '?' + get.join('&');
    } else {
      get = '';
    }

    nanoajax.ajax({
      url: surveys[survey].url + get,
      headers: {
        Accept: 'javascript/json'
      }
    }, (code: number, responseText: string) => {
      var data;
      if (code === 200) {
        try {
          data = JSON.parse(responseText);
          console.log('get response for', surveys[survey].url, get, data);
        } catch (err) {
          console.error('Error parsing response', surveys[survey].url, get, responseText);
          return;
        }
        if (typeof data === 'object' && data.results && data.results instanceof Array) {
          addSurveyData(survey, data.results);
          // Add the bounds to the requestedAreas
          if (typeof requestedAreas[survey] === 'undefined') {
            requestedAreas[survey] = []
          }
          requestedAreas[survey].push(bounds);
          redrawSurveyData(survey);
        } else {
          console.error('Unknown data received');
        }
      }
    });
  });

  //TODO can this be removed?
  if (typeof survey === 'string' && !toFetch.length) {
    redrawSurveyData(survey);
  }
}


/**
 * Redraws the given survey layer
 *
 * @param {String} String identifier of the layer to redraw
 *
 * @returns {undefined}
 */
export function redrawSurveyData(survey: string) {
  if (typeof surveyData[survey] !== 'undefined') {
    console.log('redrawing', survey)
    // Create layer group if we don't already have one
    if (typeof surveyLayers[survey] === 'undefined') {
      surveyLayers[survey] = L.layerGroup([]); // TODO Interface is wrong - parameter is optional
    } else {
      surveyLayers[survey].clearLayers();
    }

    // Build array of survey data to include, selected and order by date
    var markers = [];

    Object.keys(surveyData[survey]).forEach((point) => {
      let surveyPoint: Survey = surveyData[survey][point];

      let score = surveyScore(survey, surveyPoint);

      // Filter based on rating
      if (!Ratings.selected(score)) {
        return;
      }

      // TODO time filtering

      // Create latlong from data
      let latlng = pointLatlng(surveyPoint);

      // Get color for point
      let color = pointColor(survey, surveyPoint);

      if (color) {
        // Create point
        var marker = L.circleMarker(latlng, Object.assign({}, config.defaultMarkerOptions, {
          color: (surveyPoint.status === 'approved' ? '#ffffff' : '#666666'),
          fillColor: 'hsl(' + color[0] + ', ' + color[1] + '%, ' + color[2] + '%)',
          opacity: 1 - Math.pow(1 - color[3], 2),
          fillOpacity: color[3]
        }));

        markers.push({
          marker: marker,
          time: surveyPoint.timestamp._epoch
        });
      }
    });

    // TODO order markers by date?

    markers.forEach((marker: TimedMarker) => {
      // Add the point to the layer
      surveyLayers[survey].addLayer(marker.marker);
    });

    // Add layer to map if not already on it
    if (!Map.map.hasLayer(surveyLayers[survey])) {
      Map.map.addLayer(surveyLayers[survey]);
    }
  }
};

/**
 * Redraws all the active surveys
 *
 * @returns {undefined}
 */
export function redrawAllActive() {
  activeSurveys.forEach(redrawSurveyData);
};